---
name: accessibility-audit
description: Check a page or component for accessibility problems and fix the clear ones.
---
1. If a page is running, send inspect_page for it; otherwise read the component files.
2. Check: every interactive element is a real button or link with a name; inputs have labels; images have meaningful alt text (or empty alt if decorative); headings are in order; colour contrast is enough; focus is visible and the tab order makes sense; nothing relies on colour alone; dialogs trap and restore focus.
3. List findings with element, problem and fix. Mark which you confirmed from the page or code and which are inferences.
4. Fix the clear, local ones in one step per file. Verify again with inspect_page.
