Visit Pages at https://elizabethpass.github.io/PASS/
Google lead capture setup

1. Open script.google.com and create a new Apps Script project.
2. Paste code from GoogleAppsScript/Code.gs into the project.
3. In Apps Script, set Script Properties:
	- LEAD_RECIPIENT_EMAIL = your destination email
	- LEAD_SHEET_ID = your Google Sheet ID
	- LEAD_SHEET_NAME = Leads (or your preferred sheet tab)
4. Deploy as Web App:
	- Execute as: Me
	- Who has access: Anyone
5. Copy the Web App URL ending in /exec.
6. In contact.html, replace REPLACE_WITH_YOUR_DEPLOYMENT_ID in PASS_SITE_CONFIG.leadsEndpoint.

Behavior

- Contact form submissions are emailed with subject "Lead Capture".
- Submissions are appended to the configured Google Sheet.

Debugging checklist if submissions fail

**1. Verify the endpoint is deployed**
- Go to script.google.com and open your Apps Script project.
- Click Deploy > New deployment.
- Select "Web app" and configure:
  - Execute as: Me (your Google account)
  - Who has access: Anyone
- Copy the full /exec URL and paste into contact.html `leadsEndpoint`.

**2. Verify Script Properties are set**
- In Apps Script, click Project Settings.
- Scroll to Script Properties and add:
  - `LEAD_RECIPIENT_EMAIL` = elizabeth.pass@pass2success.com
  - `LEAD_SHEET_ID` = your Google Sheet's ID (from the URL)
  - `LEAD_SHEET_NAME` = Leads (or your preferred name)

**3. Test the deployment**
- Go to Logs in Apps Script (Ctrl+Enter or Cmd+Enter).
- Fill and submit the contact form.
- Check Logs for errors (they now log all failures).
- Check your email for the Lead Capture message.
- Check your Google Sheet for the new row.

**4. Check browser console**
- Open DevTools (F12) > Console tab.
- Try submitting the form.
- Look for fetch errors or response logs.

**5. Verify form fields are filled**
- Parent Name, Student Name, and Student Stage are all required.
- If any are missing, the form will reject locally (you'll see the error message).

**CORS error: blocked by CORS**

If you see "blocked by CORS" error in the browser console:
- The Apps Script backend has been updated with CORS headers.
- You must **redeploy the Apps Script as a new Web App deployment**.
- In Apps Script:
  1. Click Deploy > New deployment
  2. Select "Web app"
  3. Execute as: Me
  4. Who has access: Anyone
  5. Create the deployment
  6. Copy the new /exec URL
  7. Replace the endpoint URL in contact.html `PASS_SITE_CONFIG.leadsEndpoint`
- Clear your browser cache (Ctrl+Shift+Delete on Windows, Cmd+Shift+Delete on Mac).
- Test the form submission again.
