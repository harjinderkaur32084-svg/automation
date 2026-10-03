# Connect Table Master to Google Sheets

The app keeps working locally without an account. To add one-time sign-in and cloud progress:

1. Keep your target Google Sheet private; it contains student names and learning records.
2. In that Sheet, open **Extensions → Apps Script**.
3. Replace the editor contents with [`Code.gs`](./Code.gs). In `TABLE_MASTER_SPREADSHEET_ID`, replace `YOUR_GOOGLE_SHEET_ID` with your Sheet ID. Never commit the real ID to a public repository.
4. Save, select `setupTableMaster`, and click **Run**. Approve the requested Sheet permissions. This creates the `Accounts`, `Progress`, and `Sessions` tabs and privately stores the PIN-hashing pepper in Apps Script properties.
5. Select **Deploy → New deployment → Web app**.
6. Choose **Execute as: Me** and **Who has access: Anyone**, then deploy. If Google Workspace does not allow **Anyone**, ask the Workspace administrator to enable it or deploy from a personal Google account.
7. Copy the deployed web app URL ending in `/exec`.
8. Open `index.html`, choose **Parent? Set up Google Sheets** on the starting sign-in screen, paste the deployment URL into **Parent view → Cloud progress connection**, then test and save it. Enter a student name and 4-digit PIN on the sign-in screen. Use **New student? Create an account** for a new student. Creating an account writes the student's name to `Accounts`, their class and initial progress to `Progress`, and a hashed session token to `Sessions`; later progress changes sync automatically. The PIN itself is never stored.

If you change `Code.gs` after deploying, open **Deploy → Manage deployments**, edit the web app deployment, choose **New version**, and deploy again. The URL normally stays the same. The connection test checks that the URL points to a live deployment and that `setupTableMaster` was run successfully.

Common errors:

- **“Run setupTableMaster once…”**: Open the Apps Script editor from the target Sheet, select `setupTableMaster`, click **Run**, and approve permissions.
- **“Google Sheets did not respond”**: Check that the URL is the web app URL ending in `/exec`, not the Apps Script editor URL or a `/dev` test URL, and that the deployment is accessible to **Anyone**.
- **Apps Script sign-in page or access denied**: Edit the deployment to execute as **Me**, set access to **Anyone** if your account permits it, and create a new version.
- **Student name or PIN is incorrect**: Choose account creation once for a new student. Names must be unique; existing students should sign in using the same name and PIN.

PINs are salted and hashed with a server-side pepper before they are stored. The browser remembers a long-lived session token, while the Sheet stores only its hash. Student progress is saved after changes and restored when the app is opened again.

Student names must be unique in the Sheet. Remember the PIN: there is no email or PIN-recovery flow. Signing out removes that browser's session token from the Sheet. Deleting the student's rows from `Accounts`, `Progress`, and `Sessions` removes the account and its cloud records.

The web app is publicly reachable so the browser can submit sign-in requests, but account data operations require a valid random session token. Keep the Sheet private and do not share a student's PIN or browser profile. Never publish the configured Sheet ID or deployment URL in a public repository. The local website and the Apps Script deployment URL must be reachable in the browser; a web-hosted copy of the app is recommended for school use. The web-app deployment URL is separate from the Sheet URL: enter the URL copied from **Deploy → New deployment → Web app**, not the spreadsheet link.
