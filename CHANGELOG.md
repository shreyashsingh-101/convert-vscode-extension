# Changelog

All notable changes to this project will be documented in this file.

---

## [0.0.3] - Latest

### ✨ Added

- 🔍 Hybrid search in dropdowns (local filter + API search on Enter)
- ⌨️ Enter-triggered search for Projects and Experiments
- 🎯 Smart dropdown behavior (different logic for Projects / Experiments / Variations)
- 🌐 Support for **Global JS/CSS updates** via Experience API
- 🔁 "Global" option in Variations dropdown

### 🛠️ Improved

- 🚀 Optimized dropdown performance for large datasets
- 🎨 Better UX with contextual placeholders
- ⚡ Reduced unnecessary API calls (manual trigger only)

### 🐛 Fixed

- ❌ Dropdown reset issues after search
- ❌ Selection inconsistencies between search results and local state

---

## [0.0.2]

### ✨ Added

- 🌐 Ability to update **Global JS & CSS** (experience-level)
- 🔔 Confirmation modal before pushing changes
- ⏳ Loading state and disabled submit button
- 📦 Improved file handling with multi-file support

### 🛠️ Improved

- 🎯 Cleaner UI layout and spacing
- 🔄 Persistent configuration (API key, account, selections)
- 📂 Better drag & drop handling

### 🐛 Fixed

- ❌ Extension crash after publishing due to incorrect file paths
- ❌ Media file loading issue (`src` → `media` fix)
- ❌ Webview state reset on tab switch

---

## [0.0.1]

### 🎉 Initial Release

### ✨ Features

- 🔗 Connect to Convert using API key
- 📂 Select Account → Project → Experiment → Variation
- 📥 Drag & drop JS/CSS files from VS Code
- ⚡ Push code directly to Convert variations
- 🧠 Custom dropdown UI with search support
- 🛡️ File validation (JS/CSS only, size limits)

### 🧱 Foundation

- Built using VS Code Extension API
- Webview-based UI
- Convert API v2 integration
