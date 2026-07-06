async function loadStatus() {
  try {
    const bg = await messenger.runtime.getBackgroundPage();
    const status = await bg.getStatus();

    document.getElementById("processedCount").textContent = `Processed: ${status.processedCount}`;

    if (status.lastScan) {
      const date = new Date(status.lastScan);
      document.getElementById("lastScan").textContent = `Last: ${date.toLocaleDateString()}`;
    } else {
      document.getElementById("lastScan").textContent = "Last: Never";
    }
  } catch (error) {
    console.error("Failed to load status:", error);
  }
}

document.getElementById("runScanBtn").addEventListener("click", async () => {
  showStatus("Scanning all accounts...", "info");
  try {
    const bg = await messenger.runtime.getBackgroundPage();
    const result = await bg.runManualScan();
    if (result.skipped) {
      showStatus("Scan already in progress", "info");
    } else {
      showStatus(`Scan complete: ${result.added} new senders added`, "success");
    }
    await loadStatus();
  } catch (error) {
    console.error(error);
    showStatus("Error during scan", "error");
  }
});

document.getElementById("scanInboxBtn").addEventListener("click", async () => {
  showStatus("Scanning inbox...", "info");
  try {
    const bg = await messenger.runtime.getBackgroundPage();
    const result = await bg.runInboxScan();
    if (result.skipped) {
      showStatus("Scan already in progress", "info");
    } else {
      showStatus(`Inbox scan complete: ${result.added} new senders added`, "success");
    }
    await loadStatus();
  } catch (error) {
    console.error(error);
    showStatus("Error during scan", "error");
  }
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  showStatus("Clearing processed history...", "info");
  try {
    const bg = await messenger.runtime.getBackgroundPage();
    await bg.resetProcessedIds();
    showStatus("History cleared. Run a scan to re-check all messages.", "success");
    await loadStatus();
  } catch (error) {
    console.error(error);
    showStatus("Error clearing history", "error");
  }
});

document.getElementById("dedupeBtn").addEventListener("click", async () => {
  if (!confirm("Remove duplicate contacts (same email, same address book)? This deletes the extras, keeping one copy of each.")) {
    return;
  }
  showStatus("Removing duplicates...", "info");
  try {
    const bg = await messenger.runtime.getBackgroundPage();
    const result = await bg.dedupeAddressBooks();
    if (result.skipped) {
      showStatus("Scan in progress, try again shortly", "info");
    } else {
      showStatus(`Removed ${result.removed} duplicate contacts`, "success");
    }
  } catch (error) {
    console.error(error);
    showStatus("Error removing duplicates", "error");
  }
});

function showStatus(msg, type) {
  const status = document.getElementById("status");
  status.textContent = msg;
  status.className = type;
  status.style.display = "block";

  if (type === "success" || type === "error") {
    setTimeout(() => (status.style.display = "none"), 4000);
  }
}

loadStatus();