document
  .getElementById("currentFolderBtn")
  .addEventListener("click", async () => {
    const tabs = await messenger.mailTabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tabs[0]?.displayedFolderId) {
      showStatus("⚠️ No folder selected", "error");
      return;
    }

    showStatus("⏳ Extracting...", "info");

    try {
      const bg = await messenger.runtime.getBackgroundPage();
      const emails = await bg.extractFromFolder(tabs[0].displayedFolderId);
      const fileName = `emails_${new Date().toISOString().split("T")[0]}.txt`;

      // Download
      const csv = emails.join("\n");
      const blob = new Blob([csv], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);

      showStatus(`✅ Extracted ${emails.length} unique emails!`, "success");
    } catch (error) {
      console.error(error);
      showStatus("❌ Error during extraction", "error");
    }
  });

document.getElementById("allFoldersBtn").addEventListener("click", async () => {
  showStatus("⏳ Extracting from ALL folders...", "info");

  try {
    const allFolders = await messenger.folders.query({});
    const bg = await messenger.runtime.getBackgroundPage();
    const allEmails = new Set();

    for (const folder of allFolders) {
      try {
        const emails = await bg.extractFromFolder(folder.id);
        emails.forEach((e) => allEmails.add(e));
      } catch (err) {
        console.warn(`Skipped folder: ${folder.name}`, err);
      }
    }

    const csv = Array.from(allEmails).sort().join("\n");
    const blob = new Blob([csv], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `emails_all_${new Date().toISOString().split("T")[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);

    showStatus(
      `✅ Extracted ${allEmails.size} emails from all folders!`,
      "success",
    );
  } catch (error) {
    console.error(error);
    showStatus("❌ Error during processing", "error");
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
