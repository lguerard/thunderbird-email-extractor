const STORAGE_KEY_PROCESSED = "processedMessageIds";
const STORAGE_KEY_LAST_SCAN = "lastScanTimestamp";
const STORAGE_KEY_ACCOUNT_BOOKS = "accountAddressBooks";
const ALARM_NAME = "dailyEmailScan";
const SCAN_INTERVAL_MINUTES = 24 * 60;

let processedMessageIds = new Set();
let lastScanTimestamp = 0;
let accountAddressBooks = {};

async function initialize() {
  const stored = await messenger.storage.local.get([
    STORAGE_KEY_PROCESSED,
    STORAGE_KEY_LAST_SCAN,
    STORAGE_KEY_ACCOUNT_BOOKS,
  ]);

  if (stored[STORAGE_KEY_PROCESSED]) {
    processedMessageIds = new Set(stored[STORAGE_KEY_PROCESSED]);
  }
  if (stored[STORAGE_KEY_LAST_SCAN]) {
    lastScanTimestamp = stored[STORAGE_KEY_LAST_SCAN];
  }
  if (stored[STORAGE_KEY_ACCOUNT_BOOKS]) {
    accountAddressBooks = stored[STORAGE_KEY_ACCOUNT_BOOKS];
  }

  await setupDailyAlarm();
  console.log("Email Senders Extractor initialized");
  console.log(`Processed ${processedMessageIds.size} messages previously`);
  console.log(`Last scan: ${lastScanTimestamp ? new Date(lastScanTimestamp).toISOString() : "Never"}`);
}

async function setupDailyAlarm() {
  const alarms = await messenger.alarms.get(ALARM_NAME);
  if (!alarms) {
    await messenger.alarms.create(ALARM_NAME, { delayInMinutes: SCAN_INTERVAL_MINUTES });
    console.log(`Daily alarm set for every ${SCAN_INTERVAL_MINUTES} minutes`);
  }
}

messenger.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log("Daily scan triggered");
    await runDailyScan();
  }
});

async function runDailyScan() {
  try {
    const accounts = await messenger.accounts.list();
    let totalAdded = 0;

    for (const account of accounts) {
      console.log(`Scanning account: ${account.id}`);
      const result = await scanAccountForNewSenders(account);
      totalAdded += result.added;
    }

    lastScanTimestamp = Date.now();
    await messenger.storage.local.set({ [STORAGE_KEY_LAST_SCAN]: lastScanTimestamp });

    console.log(`Daily scan complete: ${totalAdded} new senders added`);
    return { added: totalAdded, timestamp: lastScanTimestamp };
  } catch (error) {
    console.error("Daily scan failed:", error);
    throw error;
  }
}

async function scanAccountForNewSenders(account) {
  let added = 0;

  const bookId = await getOrCreateAddressBookForAccount(account);
  if (!bookId) {
    console.log(`No address book found for account: ${account.id}`);
    return { added: 0 };
  }

  console.log(`Using address book: ${bookId} for account: ${account.id}`);

  const allFolders = await messenger.folders.query({ accountId: account.id });
  const inboxFolders = allFolders.filter(f => 
    f.type === "inbox" || (!f.type && f.path.toLowerCase().includes("inbox"))
  );

  if (inboxFolders.length === 0) {
    console.log(`No inbox found for account: ${account.id}`);
    return { added: 0 };
  }

  for (const folder of inboxFolders) {
    console.log(`Scanning folder: ${folder.path}`);
    const result = await scanFolderForNewSenders(folder, bookId);
    added += result;
  }

  return { added };
}

async function scanFolderForNewSenders(folder, bookId) {
  let added = 0;
  let hasMore = true;
  let messageList = null;

  try {
    messageList = await messenger.messages.list(folder.id);
  } catch (error) {
    console.error(`Cannot access folder ${folder.path}:`, error);
    return 0;
  }

  while (hasMore && messageList && messageList.messages && messageList.messages.length > 0) {
    for (const msg of messageList.messages) {
      if (processedMessageIds.has(msg.id)) {
        continue;
      }

      processedMessageIds.add(msg.id);

      if (msg.author) {
        const senderEmail = extractEmail(msg.author);
        if (senderEmail && !await isOwnEmail(senderEmail, msg.folder?.accountId)) {
          const addedContact = await addToAddressBook(bookId, senderEmail, msg.author);
          if (addedContact) {
            added++;
          }
        }
      }
    }

    if (messageList.id) {
      try {
        messageList = await messenger.messages.continueList(messageList.id);
      } catch {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
  }

  await saveProcessedIds();
  console.log(`Scanned folder ${folder.path}: ${added} new senders added`);
  return added;
}

function extractEmail(mailboxString) {
  if (!mailboxString || mailboxString.length === 0) return null;
  const match = mailboxString.match(/([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return match ? match[1].toLowerCase() : null;
}

async function isOwnEmail(email, accountId) {
  if (!accountId) return false;
  try {
    const account = await messenger.accounts.get(accountId);
    if (account && account.identities) {
      for (const identity of account.identities) {
        if (identity.email && identity.email.toLowerCase() === email.toLowerCase()) {
          return true;
        }
      }
    }
  } catch (e) {
    // Ignore
  }
  return false;
}

async function getOrCreateAddressBookForAccount(account) {
  if (accountAddressBooks[account.id]) {
    return accountAddressBooks[account.id];
  }

  try {
    const allBooks = await messenger.addressBooks.list();
    console.log(`Available address books: ${allBooks.map(b => b.name).join(", ")}`);

    let book = allBooks.find(b => b.name === account.id) || 
               allBooks.find(b => b.name.toLowerCase().includes(account.email?.split("@")[1] || ""));

    if (!book) {
      const accountName = account.email?.split("@")[1] || account.id;
      book = await messenger.addressBooks.create(`${accountName} Senders`);
      console.log(`Created new address book: ${book.name}`);
    }

    accountAddressBooks[account.id] = book.id;
    await messenger.storage.local.set({ [STORAGE_KEY_ACCOUNT_BOOKS]: accountAddressBooks });

    return book.id;
  } catch (error) {
    console.error(`Failed to get/create address book for account ${account.id}:`, error);
    return null;
  }
}

async function addToAddressBook(bookId, email, displayName) {
  if (!bookId) {
    console.error("No bookId provided to addToAddressBook");
    return false;
  }

  try {
    const contacts = await messenger.addressBooks.listContacts(bookId);
    const existingEmails = new Set(contacts.map(c => c.primaryEmail?.toLowerCase()));

    if (existingEmails.has(email.toLowerCase())) {
      return false;
    }

    let name = email.split("@")[0];
    if (displayName && displayName.includes("<")) {
      const match = displayName.match(/^([^<]+)/);
      if (match) {
        name = match[1].trim();
      }
    } else if (displayName && displayName.trim()) {
      name = displayName.trim();
    }

    await messenger.addressBooks.createContact(bookId, {
      displayName: name,
      primaryEmail: email,
    });

    console.log(`Added contact: ${email} to book ${bookId}`);
    return true;
  } catch (error) {
    console.error(`Failed to add contact ${email}:`, error);
    return false;
  }
}

async function saveProcessedIds() {
  const arr = Array.from(processedMessageIds);
  if (arr.length > 10000) {
    const trimmed = arr.slice(-5000);
    processedMessageIds = new Set(trimmed);
  }
  await messenger.storage.local.set({ [STORAGE_KEY_PROCESSED]: Array.from(processedMessageIds) });
}

messenger.menus.create({
  id: "extract-senders",
  title: "Scan & Add Senders to Address Book",
  contexts: ["folder_pane"],
});

messenger.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "extract-senders" && info.selectedFolders?.length > 0) {
    const folder = info.selectedFolders[0];
    try {
      const bookId = await getOrCreateAddressBookForAccount({ id: folder.accountId });
      const result = await scanFolderForNewSenders(folder, bookId);
      console.log(`Manual scan complete: ${result} new senders added`);
    } catch (error) {
      console.error("Manual scan failed:", error);
    }
  }
});

async function getStatus() {
  const stored = await messenger.storage.local.get([STORAGE_KEY_LAST_SCAN]);
  return {
    processedCount: processedMessageIds.size,
    lastScan: stored[STORAGE_KEY_LAST_SCAN] || null,
    accountBooks: accountAddressBooks,
  };
}

async function runManualScan() {
  return await runDailyScan();
}

initialize();