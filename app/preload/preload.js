const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('collectorAPI', {
  generateQR: (text) => ipcRenderer.invoke('collector:generate-qr', text),
  openExternalFile: (filePath) => ipcRenderer.invoke('asset:open', filePath),
  saveAsset: (payload) => ipcRenderer.invoke('asset:save-base64', payload),
  diagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  checkUpdates: () => ipcRenderer.invoke('app:check-updates'),
  createBugReport: (payload) => ipcRenderer.invoke('app:create-bug-report', payload),
  openBugReport: () => ipcRenderer.invoke('app:open-bug-report'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openVehicleWindow: (vehicleId) => ipcRenderer.invoke('vehicle:open-window', vehicleId),
  installUpdate: () => ipcRenderer.invoke('app:update-install'),
  finishInstalledUpdate: () => ipcRenderer.invoke('app:update-quit-and-install'),
  onUpdateAvailable: (fn) => ipcRenderer.on('updates:available', (_e,data)=>fn(data)),
  onUpdateDownloaded: (fn) => ipcRenderer.on('updates:downloaded', (_e,data)=>fn(data)),
  onUpdateError: (fn) => ipcRenderer.on('updates:error', (_e,data)=>fn(data))
});

contextBridge.exposeInMainWorld('storageAPI', {
  load: () => ipcRenderer.invoke('storage:load'),
  save: (state) => ipcRenderer.invoke('storage:save', state),
  recoveryStatus: () => ipcRenderer.invoke('storage:recovery-status'),
  restoreRecovery: () => ipcRenderer.invoke('storage:restore-recovery'),
  integrityCheck: () => ipcRenderer.invoke('storage:integrity-check'),
  createRecovery: (state) => ipcRenderer.invoke('storage:create-recovery', state)
});

contextBridge.exposeInMainWorld('cloudAPI', {
  chooseFolder: () => ipcRenderer.invoke('cloud:choose-folder'),
  backupAll: (payload) => ipcRenderer.invoke('cloud:backup-all', payload),
  verifyBackups: (paths) => ipcRenderer.invoke('cloud:verify-backups', paths),
  chooseBackupFile: () => ipcRenderer.invoke('cloud:choose-backup-file'),
  readBackup: (payload) => ipcRenderer.invoke('cloud:read-backup', payload),
  safetyBackup: (payload) => ipcRenderer.invoke('cloud:safety-backup', payload),
  choosePortableFolder: () => ipcRenderer.invoke('cloud:choose-portable-folder'),
  setPortablePath: (folderPath) => ipcRenderer.invoke('cloud:set-portable-path', folderPath),
  backupOnExit: (payload) => ipcRenderer.send('cloud:backup-on-exit', payload)
});

contextBridge.exposeInMainWorld('usbAPI', {
  chooseTarget: () => ipcRenderer.invoke('usb:choose-target'),
  estimate: () => ipcRenderer.invoke('usb:estimate'),
  createCopy: (payload) => ipcRenderer.invoke('usb:create-copy', payload),
  verifyCopy: (root) => ipcRenderer.invoke('usb:verify-copy', root),
  openFolder: (root) => ipcRenderer.invoke('usb:open-folder', root)
});
