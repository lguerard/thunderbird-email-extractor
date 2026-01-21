​# Email Extractor & Deduplicator

A lightweight Thunderbird WebExtension that extracts and deduplicates email addresses from folder messages.

## Features

- 📧 Extract email addresses from messages
- 🔄 Automatic deduplication with occurrence counting
- 📤 Distinguish between incoming {get} and outgoing {post} messages
- 🏷️ Display domain information for each email
- 📥 Export results to text file with formatting

## Installation

### Prerequisites

- Thunderbird 102 or higher
- Administrator access to Thunderbird

### Steps

1. **Download or clone the repository:**

```bash
git clone https://github.com/yourusername/email-extractor.git
cd email-extractor
```

2. Package the extension:

```bash
zip -r email-extractor.xpi manifest.json background.js popup.html popup.js icon.png README.md
```

3. Install in Thunderbird:

- Open Thunderbird
- Go to Menu (≡) → Add-ons and themes
- Click the gear icon (⚙️) in top right corner
- Select Install Add-on From File
- Choose email-extractor.xpi
- Restart Thunderbird

## Usage

### Extract Emails from a Folder

1. Right-click any folder in the folder pane (left sidebar)
2. Select "Ekstrakcja & Deduplikacja Emaili" (Extract & Deduplicate Emails)
3. Wait for processing (time depends on folder size)
4. A .txt file will automatically download to your Downloads folder

### Output Format

```
The exported file contains:
{type} [number of appearances] ('domain') email
{get}  ("example.com") sender@example.com[1]
{get}  ("company.org") contact@company.org[2]
{post}  ("mail.io") recipient@mail.io[3]
{post}  ("domain.pl") user@domain.pl[4]
```

### Legend:

- `{get}` - Incoming messages (sender addresses counted)

- `{post}` - Outgoing messages (recipient addresses counted)

- `[N]` - Number of times the email appears

- `('domain')` - Email domain

```
email-extractor/
├── manifest.json      # Extension configuration
├── background.js      # Main logic and API calls
├── popup.html         # UI popup template
├── popup.js           # Popup interaction logic
├── icon.png           # Extension icon (16x16)
└── README.md          # Documentation
```

## How It Works

### Message Classification

- Checks `specialUse` property or folder path
- `sent`/`drafts` folders → outgoing messages {post}
- Other folders → incoming messages {get}

### Email Extraction

- Incoming {get}: Extracts sender addresses from `author` field
- Outgoing {post}: Extracts recipient addresses from `recipients`, `ccList`, `bccList` fields

### Deduplication

- Normalizes all emails to lowercase
- Counts occurrences using a Map data structure
- Sorts by frequency (descending) then alphabetically

### Export

- Formats results with type, count, domain, and email
- Downloads as text file with ISO timestamp

### Technical Details

- API: Thunderbird WebExtension API (Manifest V3)
- Permissions: accountsRead, messagesRead, menus
- Compatibility: Thunderbird 102+
- Language: JavaScript (ES6+)
- No external dependencies

## Troubleshooting

### Extension won't install

- Ensure Thunderbird version is 102 or higher
- Verify `manifest.json` is valid JSON
- Try reinstalling: Remove extension first, then install again

### No emails extracted

- Verify folder contains messages
- Check browser console for errors: Menu → Tools → Developer → Error Console (`Ctrl+Shift+J`)
- Ensure messages have standard email format (author/recipients fields populated)
- Try with a smaller folder first

### File not downloading

- Check Thunderbird download settings
- Verify Downloads folder exists and has write permissions
- Try downloading with a different folder

## Development

### Debug Mode

Add debug logging in background.js:

```bash
console.log("Debug message:", variable);
```

View logs in Thunderbird:
Menu (≡) → Tools → Developer → Error Console (`Ctrl+Shift+J`)

### Modify Extension

1. Edit source files (`.js`, `.html`, `etc.`)
2. Repackage extension:

```bash
zip -r email-extractor.xpi manifest.json background.js popup.html popup.js icon.png README.md
```

3. Reinstall in Thunderbird

## License

MIT License - See [LICENSE](LICENSE) file for details.

## Author

@adamzagorski92
