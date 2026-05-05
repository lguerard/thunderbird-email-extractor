const STORAGE_KEY_PROCESSED = "processedMessageIds";
const STORAGE_KEY_LAST_SCAN = "lastScanTimestamp";
const STORAGE_KEY_ADDRESS_BOOK = "targetAddressBookId";
const ALARM_NAME = "dailyEmailScan";
const SCAN_INTERVAL_MINUTES = 24 * 60;

let processedMessageIds = new Set();
let lastScanTimestamp = 0;
let targetAddressBookId = null;

async function initialize() {
  const stored = await messenger.storage.local.get([
    STORAGE_KEY_PROCESSED,
    STORAGE_KEY_LAST_SCAN,
    STORAGE_KEY_ADDRESS_BOOK,
  ]);

  if (stored[STORAGE_KEY_PROCESSED]) {
    processedMessageIds = new Set(stored[STORAGE_KEY_PROCESSED]);
  }
  if (stored[STORAGE_KEY_LAST_SCAN]) {
    lastScanTimestamp = stored[STORAGE_KEY_LAST_SCAN];
  }
  if (stored[STORAGE_KEY_ADDRESS_BOOK]) {
    targetAddressBookId = stored[STORAGE_KEY_ADDRESS_BOOK];
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
  const inboxFolders = [];

  const allFolders = await messenger.folders.get(account.id);

  async function collectFolders(folders) {
    for (const folder of folders) {
      if (folder.type === "inbox" || (!folder.type && folder.path.toLowerCase().includes("inbox"))) {
        inboxFolders.push(folder);
      }
      if (folder.subFolders) {
        await collectFolders(folder.subFolders);
      }
    }
  }
  await collectFolders(allFolders);

  if (inboxFolders.length === 0) {
    console.log(`No inbox found for account: ${account.id}`);
    return { added: 0 };
  }

  for (const folder of inboxFolders) {
    console.log(`Scanning folder: ${folder.path}`);
    const result = await scanFolderForNewSenders(folder);
    added += result;
  }

  return { added };
}

async function scanFolderForNewSenders(folder) {
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
        if (senderEmail && !isOwnEmail(senderEmail, msg.folder?.accountId)) {
          const addedContact = await addToAddressBook(senderEmail, msg.author);
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

async function addToAddressBook(email, displayName) {
  try {
    let bookId = targetAddressBookId;

    if (!bookId) {
      const books = await messenger.addressBooks.list();
      if (books.length > 0) {
        bookId = books[0].id;
        targetAddressBookId = bookId;
        await messenger.storage.local.set({ [STORAGE_KEY_ADDRESS_BOOK]: bookId });
      } else {
        const newBook = await messenger.addressBooks.create("Collected Senders");
        bookId = newBook.id;
        targetAddressBookId = bookId;
        await messenger.storage.local.set({ [STORAGE_KEY_ADDRESS_BOOK]: bookId });
      }
    }

    const contacts = await messenger.addressBooks.listContacts(bookId);
    const existingEmails = new Set(contacts.map(c => c.primaryEmail?.toLowerCase()));

    if (existingEmails.has(email.toLowerCase())) {
      return false;
    }

    const name = displayName && !displayName.includes("<") ? displayName : email.split("@")[0];

    await messenger.addressBooks.createContact(bookId, {
      displayName: name,
      primaryEmail: email,
    });

    console.log(`Added contact: ${email}`);
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
      const result = await scanFolderForNewSenders(folder);
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
    addressBookId: targetAddressBookId,
  };
}

async function setAddressBook(bookId) {
  targetAddressBookId = bookId;
  await messenger.storage.local.set({ [STORAGE_KEY_ADDRESS_BOOK]: bookId });
}

async function runManualScan() {
  return await runDailyScan();
}

initialize();