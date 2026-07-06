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
  await setupMenu();
  
  console.log("Email Senders Extractor initialized");
  console.log(`Processed ${processedMessageIds.size} messages previously`);
  console.log(`Last scan: ${lastScanTimestamp ? new Date(lastScanTimestamp).toISOString() : "Never"}`);
  console.log(`Account address books: ${JSON.stringify(accountAddressBooks)}`);
}

async function setupMenu() {
  try {
    await messenger.menus.create({
      id: "extract-senders",
      title: "Scan & Add Senders to Address Book",
      contexts: ["folder_pane"],
    });
  } catch (e) {
    console.log("Menu already exists or error:", e.message);
  }
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

messenger.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "extract-senders" && info.selectedFolders?.length > 0) {
    const folder = info.selectedFolders[0];
    try {
      const accountInfo = await messenger.accounts.get(folder.accountId);
      const bookId = await getOrCreateAddressBookForAccount(accountInfo);
      if (bookId) {
        const result = await scanFolderForNewSenders(folder, bookId);
        console.log(`Manual scan complete: ${result} new senders added`);
      }
    } catch (error) {
      console.error("Manual scan failed:", error);
    }
  }
});

async function runDailyScan() {
  try {
    const accounts = await messenger.accounts.list();
    console.log(`Found ${accounts.length} accounts`);
    let totalAdded = 0;

    for (const account of accounts) {
      console.log(`Scanning account: ${account.id} (${account.email})`);
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

  const accountInfo = await messenger.accounts.get(account.id);
  console.log(`Account info: ${JSON.stringify(accountInfo)}`);
  
  const bookId = await getOrCreateAddressBookForAccount(accountInfo);
  if (!bookId) {
    console.log(`No address book found for account: ${account.id}`);
    return { added: 0 };
  }

  console.log(`Using address book: ${bookId} for account: ${account.id}`);

  const allFolders = await messenger.folders.query({ accountId: account.id });
  console.log(`Found ${allFolders.length} folders in account`);
  
  const inboxFolders = allFolders.filter(f => 
    f.type === "inbox" || (!f.type && f.path.toLowerCase().includes("inbox"))
  );

  console.log(`Found ${inboxFolders.length} inbox folders`);

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

  console.log(`Listing messages for folder: ${folder.id}`);
  
  try {
    messageList = await messenger.messages.list(folder.id);
  } catch (error) {
    console.error(`Cannot access folder ${folder.path}:`, error);
    return 0;
  }

  if (!messageList || !messageList.messages) {
    console.log(`No messages in folder ${folder.path}`);
    return 0;
  }

  console.log(`Found ${messageList.messages.length} messages in first batch`);

  while (hasMore && messageList && messageList.messages && messageList.messages.length > 0) {
    for (const msg of messageList.messages) {
      if (processedMessageIds.has(msg.id)) {
        continue;
      }

      let handled = true;

      if (msg.author) {
        console.log(`Processing author: ${msg.author}`);
        const senderEmail = extractEmail(msg.author);
        if (senderEmail) {
          console.log(`Extracted email: ${senderEmail}`);
          const isOwn = await isOwnEmail(senderEmail, folder.accountId);
          console.log(`Is own email: ${isOwn}`);

          if (!isOwn) {
            const result = await addToAddressBook(bookId, senderEmail, msg.author);
            console.log(`Add contact result: ${result}`);
            if (result === "added") {
              added++;
            } else if (result === "error") {
              handled = false;
            }
          }
        }
      }

      if (handled) {
        processedMessageIds.add(msg.id);
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
    console.log("isOwnEmail check failed:", e.message);
  }
  return false;
}

async function getOrCreateAddressBookForAccount(account) {
  const accountId = account.id;

  try {
    console.log("Getting address books list...");
    const allBooks = await messenger.addressBooks.list();
    console.log(`Available address books: ${JSON.stringify(allBooks)}`);

    if (accountAddressBooks[accountId]) {
      const cachedId = accountAddressBooks[accountId];
      if (allBooks.some(b => b.id === cachedId)) {
        return cachedId;
      }
      console.log(`Cached address book ${cachedId} no longer exists, recreating...`);
      delete accountAddressBooks[accountId];
    }

    if (allBooks.length === 0) {
      console.log("No address books exist, creating one...");
      const domain = account.email?.split("@")[1] || "default";
      const newBook = await messenger.addressBooks.create(`${domain} Contacts`);
      console.log(`Created new address book: ${newBook.name} (${newBook.id})`);
      accountAddressBooks[accountId] = newBook.id;
      await messenger.storage.local.set({ [STORAGE_KEY_ACCOUNT_BOOKS]: accountAddressBooks });
      return newBook.id;
    }

    const domain = account.email?.split("@")[1]?.toLowerCase() || "";
    
    let book = allBooks.find(b => b.name.toLowerCase().includes(domain));
    if (!book) {
      book = allBooks[0];
    }

    console.log(`Using address book: ${book.name} (${book.id})`);
    accountAddressBooks[accountId] = book.id;
    await messenger.storage.local.set({ [STORAGE_KEY_ACCOUNT_BOOKS]: accountAddressBooks });

    return book.id;
  } catch (error) {
    console.error(`Failed to get/create address book for account ${accountId}:`, error);
    return null;
  }
}

async function addToAddressBook(bookId, email, displayName) {
  if (!bookId) {
    console.error("No bookId provided to addToAddressBook");
    return "error";
  }

  try {
    console.log(`Listing contacts in book ${bookId}...`);
    const contacts = await messenger.addressBooks.listContacts(bookId);
    console.log(`Found ${contacts.length} existing contacts`);

    const existingEmails = new Set(contacts.map(c => c.primaryEmail?.toLowerCase()));

    if (existingEmails.has(email.toLowerCase())) {
      console.log(`Email ${email} already exists in address book`);
      return "exists";
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

    console.log(`Creating contact: ${name} <${email}>`);
    await messenger.addressBooks.createContact(bookId, {
      displayName: name,
      primaryEmail: email,
    });

    console.log(`Successfully added contact: ${email}`);
    return "added";
  } catch (error) {
    console.error(`Failed to add contact ${email}:`, error);
    return "error";
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

async function resetProcessedIds() {
  processedMessageIds = new Set();
  await messenger.storage.local.set({ [STORAGE_KEY_PROCESSED]: [] });
  console.log("Processed message history cleared");
}

initialize();