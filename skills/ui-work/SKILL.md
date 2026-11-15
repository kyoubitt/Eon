---
name: ui-work
description: Build or fix a user interface and check it by looking at the running page, not by guessing.
---
1. Find how the project builds its UI (framework, components folder, styles, design tokens). Copy its patterns, spacing, colours and component names; do not invent a new style.
2. Look before you change: if a dev server is running, send inspect_page for its URL (sizes, colours, disabled states as text) and a screenshot with a precise question. If it is not running, ask the user for the command or run it from the detected commands.
3. Plan one step per component or file. Validation is: the page loads, the target element is present with the right size and colour, and the project's own test or lint command passes.
4. Make the edit. Keep markup accessible: real buttons and labels, alt text, visible focus, enough contrast. Do not rely on colour alone.
5. Check responsiveness: inspect the page again at a narrow width if the tool allows it, and look for overflow, cut-off text and overlapping elements.
6. Verify with inspect_page again and compare with step 2. Say exactly what changed (element, old value, new value). Do not claim it looks right unless you checked.
