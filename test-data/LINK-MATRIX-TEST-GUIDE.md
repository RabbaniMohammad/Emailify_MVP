# Link Matrix Validation Test Guide

## 📋 Overview
This test data helps you verify the **Link Validation** feature in the QA Use Variant page.

The feature compares:
- **URLs from your source file** (CSV/Excel with "valid links" column)
- **URLs found in your HTML template**

And shows which links are:
- ✅ **Valid** (in both file and HTML)
- ⚠️ **Missing from HTML** (in file but not in HTML)
- ⚠️ **Extra in HTML** (in HTML but not in file)

---

## 📁 Test Files

### 1. `link-matrix-test.csv`
Sample CSV file with 11 URLs in the "valid links" column.

**Column header:** `valid links`

**URLs included:**
```
https://example.com/product1          ✅ Also in HTML
https://example.com/product2          ✅ Also in HTML
https://example.com/product3          ⚠️ NOT in HTML (Missing from HTML)
https://shop.example.com/new-arrivals ✅ Also in HTML
https://blog.example.com/latest-post  ✅ Also in HTML
https://support.example.com/contact   ✅ Also in HTML
https://example.com/special-offer     ⚠️ NOT in HTML (Missing from HTML)
https://newsletter.example.com/unsubscribe ✅ Also in HTML
https://missing-from-html.com/page1   ⚠️ NOT in HTML (Missing from HTML)
https://missing-from-html.com/page2   ⚠️ NOT in HTML (Missing from HTML)
https://not-in-template.com/newlink   ⚠️ NOT in HTML (Missing from HTML)
```

---

### 2. `sample-email-template.html`
Sample HTML email template with 8 URLs.

**URLs included in HTML:**
```
https://example.com/product1          ✅ Also in CSV
https://example.com/product2          ✅ Also in CSV
https://shop.example.com/new-arrivals ✅ Also in CSV
https://blog.example.com/latest-post  ✅ Also in CSV
https://example.com/clearance         ⚠️ NOT in CSV (Extra link in HTML)
https://example.com/about-us          ⚠️ NOT in CSV (Extra link in HTML)
https://support.example.com/contact   ✅ Also in CSV
https://newsletter.example.com/unsubscribe ✅ Also in CSV
```

---

## 🧪 Expected Validation Results

When you upload the CSV and use the HTML template, you should see:

### ✅ **Valid Links (6 total)** - Present in both CSV and HTML:
1. `https://example.com/product1`
2. `https://example.com/product2`
3. `https://shop.example.com/new-arrivals`
4. `https://blog.example.com/latest-post`
5. `https://support.example.com/contact`
6. `https://newsletter.example.com/unsubscribe`

### ⚠️ **Missing from HTML (5 total)** - In CSV but NOT in HTML:
1. `https://example.com/product3`
2. `https://example.com/special-offer`
3. `https://missing-from-html.com/page1`
4. `https://missing-from-html.com/page2`
5. `https://not-in-template.com/newlink`

### ⚠️ **Extra in HTML (2 total)** - In HTML but NOT in CSV:
1. `https://example.com/clearance`
2. `https://example.com/about-us`

---

## 🔧 How to Test

### Step 1: Navigate to QA Use Variant Page
1. Open your app and navigate to a template in the QA section
2. Go to the "Use Variant" page for any template

### Step 2: Upload the CSV File
1. In the **"Finalize & Validate"** section (right column)
2. Look for the **"Upload CSV/Excel"** button
3. Click it and select `link-matrix-test.csv`
4. You should see: ✅ **"11 valid link(s) loaded"**

### Step 3: Add the HTML Template
1. In the HTML editor, clear any existing content
2. Copy and paste the contents of `sample-email-template.html`
3. Or use the file upload to load it

### Step 4: Review Validation Results
The **"Validation Results"** section should appear showing:

**Total links to validate:** 13 links
- 6 links with ✅ green checkmark (valid)
- 5 links with ⚠️ yellow warning: "Missing from HTML"
- 2 links with ⚠️ yellow warning: "Extra link in HTML"

### Step 5: Test Screenshot Capture
For any **missing** or **extra** links, you can click the camera icon to manually capture a screenshot and add it to the validation.

---

## 📊 Visual Indicators

### Valid Link (Green):
```
✅ https://example.com/product1
   ✓ In CSV and HTML
```

### Missing from HTML (Yellow):
```
⚠️ https://missing-from-html.com/page1
   Missing from HTML
```

### Extra in HTML (Yellow):
```
⚠️ https://example.com/clearance
   Extra link in HTML
```

---

## 🎯 Test Scenarios

### Scenario 1: Perfect Match
**Modify CSV** to only include URLs that are in the HTML.
**Expected:** All links show as ✅ valid (green)

### Scenario 2: URLs Missing from HTML
**Use the provided CSV** with more URLs than in HTML.
**Expected:** Extra URLs show as ⚠️ "Missing from HTML" (yellow)

### Scenario 3: Extra URLs in HTML
**Add more links to HTML** that aren't in the CSV.
**Expected:** These show as ⚠️ "Extra link in HTML" (yellow)

### Scenario 4: Empty CSV
**Don't upload any CSV**.
**Expected:** Validation section should NOT appear (empty state)

---

## 📝 CSV Format Requirements

Your CSV must have a column header named exactly:
```
valid links
```
(Case-insensitive, so `Valid Links` or `VALID LINKS` also works)

Each row should contain one URL:
```csv
valid links
https://example.com/page1
https://example.com/page2
https://shop.example.com/product
```

### Excel Format
You can also use `.xlsx` or `.xls` files with the same structure:
- First row: column header `valid links`
- Following rows: one URL per row

---

## 🐛 Common Issues

### "No 'valid links' column found"
- Check that your CSV has a column header exactly named `valid links`
- Make sure it's in the first row
- Case doesn't matter but spelling does

### Links not being detected
- URLs must start with `http://` or `https://`
- Invalid URLs are filtered out (mailto:, tel:, #, javascript:void(0))

### File upload not working
- Supported formats: `.csv`, `.xlsx`, `.xls`
- Check browser console for errors

---

## 💡 Tips

1. **Export from Excel**: Save as CSV (UTF-8) for best compatibility
2. **URL Validation**: The system automatically filters out placeholder links like `#` and `javascript:void(0)`
3. **Screenshot Capture**: You can manually capture screenshots for ANY URL, even if it's not in the CSV
4. **Real-time Updates**: The validation updates automatically when you upload a new CSV or modify the HTML

---

## 📞 Support

If you encounter issues with the link validation feature:
1. Check the browser console for error messages
2. Verify your CSV format matches the requirements
3. Ensure URLs are properly formatted with `http://` or `https://`

---

**Created:** October 18, 2025  
**Purpose:** Testing link matrix validation feature  
**Files:** link-matrix-test.csv, sample-email-template.html
