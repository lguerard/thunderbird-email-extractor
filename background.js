// ============================================================================
// EMAIL EXTRACTOR - with distinction between incoming and outgoing messages
// ============================================================================

messenger.menus.create({
  id: "extract-emails",
  title: "Email Extraction & Deduplication",
  contexts: ["folder_pane"],
});

messenger.menus.onClicked.addListener(async (info, tab) => {
  if (
    info.menuItemId === "extract-emails" &&
    info.selectedFolders?.length > 0
  ) {
    const folder = info.selectedFolders[0];

    try {
      const emails = await extractFromFolder(
        folder.id,
        folder.path,
        folder.specialUse,
      );
      downloadCSV(emails, folder.name);
    } catch (error) {
      console.error("Error:", error);
    }
  }
});

async function extractFromFolder(folderId, folderPath, specialUse) {
  const emailCountMapGet = new Map();
  const emailCountMapPost = new Map();

  let isOutgoingFolder = false;

  if (specialUse && Array.isArray(specialUse) && specialUse.length > 0) {
    isOutgoingFolder =
      specialUse.includes("sent") || specialUse.includes("drafts");
  } else if (folderPath) {
    isOutgoingFolder =
      folderPath.toLowerCase().includes("sent") ||
      folderPath.toLowerCase().includes("drafts");
  }

  console.log(`📁 Folder: ${folderPath}`);
  console.log(`🏷️ Special Use: ${specialUse}`);
  console.log(
    `📤 Type: ${isOutgoingFolder ? "SENT (post)" : "INCOMING (get)"}`,
  );

  try {
    let messageList = await messenger.messages.list(folderId);

    while (
      messageList &&
      messageList.messages &&
      messageList.messages.length > 0
    ) {
      for (const msg of messageList.messages) {
        if (isOutgoingFolder) {
          if (msg.recipients && Array.isArray(msg.recipients)) {
            for (const r of msg.recipients) {
              extractAndCount(r, emailCountMapPost);
            }
          }

          if (msg.ccList && Array.isArray(msg.ccList)) {
            for (const c of msg.ccList) {
              extractAndCount(c, emailCountMapPost);
            }
          }

          if (msg.bccList && Array.isArray(msg.bccList)) {
            for (const b of msg.bccList) {
              extractAndCount(b, emailCountMapPost);
            }
          }
        } else {
          extractAndCount(msg.author, emailCountMapGet);
        }
      }

      if (messageList.id) {
        messageList = await messenger.messages.continueList(messageList.id);
      } else {
        break;
      }
    }
  } catch (error) {
    console.error("Error in extractFromFolder:", error);
    throw error;
  }

  const formattedEmailsGet = Array.from(emailCountMapGet.entries()).map(
    ([email, count]) => {
      const domain = extractDomain(email);
      return {
        type: "get",
        email: email,
        count: count,
        domain: domain,
        formatted: `{get} [${count}] ("${domain}") ${email}`,
      };
    },
  );

  const formattedEmailsPost = Array.from(emailCountMapPost.entries()).map(
    ([email, count]) => {
      const domain = extractDomain(email);
      return {
        type: "post",
        email: email,
        count: count,
        domain: domain,
        formatted: `{post} [${count}] ("${domain}") ${email}`,
      };
    },
  );

  const allEmails = [...formattedEmailsGet, ...formattedEmailsPost];

  allEmails.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "get" ? -1 : 1;
    }
    if (b.count !== a.count) return b.count - a.count;
    return a.email.localeCompare(b.email);
  });

  return allEmails;
}

function extractAndCount(mailboxString, emailCountMap) {
  if (!mailboxString || mailboxString.length === 0) return;

  const addr = extractEmailFromMailbox(mailboxString);
  if (addr) {
    const lowerAddr = addr.toLowerCase();
    emailCountMap.set(lowerAddr, (emailCountMap.get(lowerAddr) || 0) + 1);
  }
}

function extractEmailFromMailbox(mailboxString) {
  if (!mailboxString || mailboxString.length === 0) return null;

  const match = mailboxString.match(
    /([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
  );

  return match ? match[1] : null;
}

function extractDomain(email) {
  const parts = email.split("@");
  return parts.length > 1 ? parts[1] : "";
}

function downloadCSV(formattedEmails, folderName) {
  const header = "{type} [number of appearances] ('domain') email\n";
  const lines = formattedEmails.map((item) => item.formatted);
  const csv = header + lines.join("\n");

  const blob = new Blob([csv], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `emails_${folderName.replace(/[/\\?%*:|"<>]/g, "_")}_${new Date().toISOString().split("T")[0]}.txt`;
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
