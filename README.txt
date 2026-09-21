VINTAGE & CLASSIC VEHICLE MAINTENANCE & RESTORATION RECORDS
COLLECTOR EDITION — VERSION 7.1

Version 7.1 adds separate vehicle workspaces, collection status categories, vehicle restoration progress, footer bug reporting, and GitHub-based update checking/updating for both installed and portable editions.

IMPORTANT RELEASE MODEL
Normal build workflows do NOT publish releases automatically and do not require GH_TOKEN. Use the separate “Publish Version 7.1 GitHub Release” workflow when you intentionally want to publish a release.

BUG REPORT PRIVACY
Bug reports open a GitHub issue draft for review. Vehicle records, VINs, registrations, photographs, documents, addresses, backups and the SQLite database are not automatically uploaded.

UPDATES
The application checks the latest GitHub Release. Installed editions use Electron's update mechanism. Portable editions download the new portable EXE, preserve the adjacent data folder, and restart after replacing the executable.
