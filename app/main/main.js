const { app, BrowserWindow, Menu, dialog, shell, ipcMain, nativeTheme } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');
const initSqlJs = require('sql.js');
const https = require('https');

let mainWindow;
let splashWindow;
let SQL;
let db;
let dbPath;
let recoveryPath;
let portableDataPath = null;
let portableAutoRoot = null;
let isPortableMode = false;
const vehicleWindows = new Map();

function detectPortableRoot() {
  const envDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (envDir) return path.join(envDir, 'Vintage Classic Vehicle Records Data');
  const exeDir = path.dirname(process.execPath);
  const marker = path.join(exeDir, 'PortableMode.ini');
  if (fs.existsSync(marker)) return path.join(exeDir, 'Vintage Classic Vehicle Records Data');
  return null;
}
function appDataRoot() {
  return portableDataPath || portableAutoRoot || app.getPath('userData');
}

function ensureDirs() {
  const root = appDataRoot();
  for (const name of ['Data','Assets','Assets/Photos','Assets/Documents','Recovery','Safety Backups']) {
    fs.mkdirSync(path.join(root,name),{recursive:true});
  }
  dbPath = path.join(root,'Data','collector-records.sqlite');
  recoveryPath = path.join(root,'Recovery','latest-recovery.json');
}
async function initDatabase() {
  SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  ensureDirs();
  db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.run(`INSERT OR REPLACE INTO schema_info(key,value) VALUES ('schema_version','6')`);
  persistDatabase();
}
function persistDatabase() {
  const temp = `${dbPath}.tmp`;
  fs.writeFileSync(temp, Buffer.from(db.export()));
  fs.renameSync(temp, dbPath);
}
function readState() {
  const result = db.exec('SELECT json, updated_at FROM app_state WHERE id=1');
  if (!result.length || !result[0].values.length) return { state:null, updatedAt:null, databasePath:dbPath };
  return { state:JSON.parse(result[0].values[0][0]), updatedAt:result[0].values[0][1], databasePath:dbPath };
}
function writeState(state) {
  const now = new Date().toISOString();
  const json = JSON.stringify(state);
  db.run('INSERT OR REPLACE INTO app_state(id,json,updated_at) VALUES (1,?,?)',[json,now]);
  persistDatabase();
  return {ok:true,updatedAt:now,databasePath:dbPath};
}
function sendClick(id) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)})?.click()`);
}
function rememberWindowBounds(key, win){
  try{
    const file=path.join(app.getPath('userData'),'window-bounds.json');
    let all={}; try{all=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    const b=win.getBounds(); all[key]=b; fs.writeFileSync(file,JSON.stringify(all,null,2));
  }catch{}
}
function loadWindowBounds(key, fallback){
  try{const file=path.join(app.getPath('userData'),'window-bounds.json'); const all=JSON.parse(fs.readFileSync(file,'utf8')); return all[key]||fallback;}catch{return fallback;}
}
function createVehicleWindow(vehicleId){
  if(vehicleWindows.has(vehicleId)){
    const w=vehicleWindows.get(vehicleId); if(!w.isDestroyed()){w.focus(); return w;}
  }
  const b=loadWindowBounds(`vehicle-${vehicleId}`,{width:1280,height:850});
  const w=new BrowserWindow({width:b.width,height:b.height,x:b.x,y:b.y,minWidth:900,minHeight:650,icon:path.join(__dirname,'..','..','assets','app.ico'),title:'Vehicle Workspace',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'..','preload','preload.js'),spellcheck:true}});
  w.loadFile(path.join(__dirname,'..','renderer','index.html'),{hash:`vehicle=${encodeURIComponent(vehicleId)}`});
  vehicleWindows.set(vehicleId,w);
  w.on('resize',()=>rememberWindowBounds(`vehicle-${vehicleId}`,w));
  w.on('move',()=>rememberWindowBounds(`vehicle-${vehicleId}`,w));
  w.on('closed',()=>vehicleWindows.delete(vehicleId));
  return w;
}
let bugReportWindow;
function createBugReportWindow(){
  if(bugReportWindow && !bugReportWindow.isDestroyed()){ bugReportWindow.focus(); return bugReportWindow; }
  bugReportWindow=new BrowserWindow({width:760,height:820,minWidth:650,minHeight:700,show:false,autoHideMenuBar:true,icon:path.join(__dirname,'..','..','assets','app.ico'),title:'Report a Bug – Vintage & Classic Vehicle Records',parent:mainWindow,modal:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'..','preload','preload.js'),spellcheck:true}});
  bugReportWindow.loadFile(path.join(__dirname,'..','renderer','bug-report.html'));
  bugReportWindow.once('ready-to-show',()=>bugReportWindow.show());
  bugReportWindow.on('closed',()=>{bugReportWindow=null;});
  return bugReportWindow;
}

function setupAutoUpdater(){
  autoUpdater.autoDownload=false;
  autoUpdater.autoInstallOnAppQuit=false;
  autoUpdater.on('update-available',info=>mainWindow?.webContents.send('updates:available',{version:info.version}));
  autoUpdater.on('update-not-available',info=>mainWindow?.webContents.send('updates:not-available',{version:info.version||app.getVersion()}));
  autoUpdater.on('download-progress',progress=>mainWindow?.webContents.send('updates:progress',{percent:Number(progress.percent||0),transferred:Number(progress.transferred||0),total:Number(progress.total||0),bytesPerSecond:Number(progress.bytesPerSecond||0),mode:'installed'}));
  autoUpdater.on('update-downloaded',info=>mainWindow?.webContents.send('updates:downloaded',{version:info.version}));
  autoUpdater.on('error',err=>mainWindow?.webContents.send('updates:error',{error:err.message}));
}
function scheduleStartupUpdateCheck(){
  if(!app.isPackaged)return;
  setTimeout(async()=>{
    try{
      if(isPortableMode){
        const r=await getJson('https://api.github.com/repos/DelboyGames/vintage-classic-car-records/releases/latest');
        const latest=String(r.tag_name||r.name||'').replace(/^v/i,'');
        if(latest && latest!==app.getVersion()) mainWindow?.webContents.send('updates:startup-available',{version:latest,url:r.html_url||null});
        else mainWindow?.webContents.send('updates:startup-not-available',{version:app.getVersion()});
      }else{ await autoUpdater.checkForUpdates(); }
    }catch(e){ mainWindow?.webContents.send('updates:startup-error',{error:e.message}); }
  },2500);
}
function createWindow() {
  splashWindow = new BrowserWindow({width:520,height:410,frame:false,transparent:true,resizable:false,alwaysOnTop:true,center:true,skipTaskbar:true,webPreferences:{contextIsolation:true,sandbox:true}});
  splashWindow.loadFile(path.join(__dirname,'..','renderer','splash.html'));
  mainWindow = new BrowserWindow({
    width: 1440,height: 920,minWidth: 980,minHeight: 700,show:false,
    backgroundColor:'#eee5d8',icon:path.join(__dirname,'..','..','assets','app.ico'),autoHideMenuBar:false,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'..','preload','preload.js'),spellcheck:true}
  });
  mainWindow.loadFile(path.join(__dirname,'..','renderer','index.html'));
  mainWindow.on('resize',()=>rememberWindowBounds('main',mainWindow));
  mainWindow.on('move',()=>rememberWindowBounds('main',mainWindow));
  mainWindow.once('ready-to-show',()=>setTimeout(()=>{if(splashWindow&&!splashWindow.isDestroyed())splashWindow.close();mainWindow.show();},900));
  mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/i.test(url))shell.openExternal(url);return{action:'deny'};});
}
function buildMenu() {
  const template=[
    {label:'File',submenu:[
      {label:'Add Vehicle',accelerator:'CmdOrCtrl+N',click:()=>sendClick('addVehicleBtn')},
      {label:'Add Maintenance Record',accelerator:'CmdOrCtrl+Shift+N',click:()=>sendClick('addRecordBtn')},
      {label:'Add Restoration Record',accelerator:'CmdOrCtrl+Alt+N',click:()=>sendClick('addRestorationBtn')},
      {type:'separator'},
      {label:'Search All Records',accelerator:'CmdOrCtrl+F',click:()=>sendClick('globalSearchBtn')},
      {label:'Backup Centre',click:()=>mainWindow.webContents.executeJavaScript(`activeTab='backup';renderMain()` )},
      {label:'Create Portable USB Copy',click:()=>mainWindow.webContents.executeJavaScript(`activeTab='backup';renderMain();setTimeout(()=>document.getElementById('createUsbCopyBtn')?.click(),100)` )},
      {type:'separator'},{label:'Print Current Vehicle',accelerator:'CmdOrCtrl+P',click:()=>sendClick('printBtn')},{type:'separator'},{role:'quit'}]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'reload'},{role:'togglefullscreen'},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]},
    {label:'Help',submenu:[{label:'Check for Updates',click:()=>mainWindow.webContents.executeJavaScript(`document.getElementById('checkUpdatesBtn')?.click()`)},{label:'Report a Bug',click:()=>mainWindow.webContents.executeJavaScript(`document.getElementById('reportBugBtn')?.click()`)},{label:'Diagnostics',click:()=>mainWindow.webContents.executeJavaScript(`document.getElementById('diagnosticsBtn')?.click()`)},{label:'About',click:()=>dialog.showMessageBox(mainWindow,{type:'info',title:'Collector Edition',message:'Vintage & Classic Vehicle Maintenance & Restoration Records',detail:`Collector Edition Version ${app.getVersion()}\n\nSQLite database storage, offline-first worldwide support and verified backups.`})}]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function checksum(data){return crypto.createHash('sha256').update(data).digest('hex');}
function encryptText(text,password){const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=crypto.scryptSync(password,salt,32),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]),tag=cipher.getAuthTag();return Buffer.concat([Buffer.from('VCCRBK1'),salt,iv,tag,body]);}
function decryptText(buf,password){if(buf.subarray(0,7).toString()!=='VCCRBK1')return buf.toString('utf8');const salt=buf.subarray(7,23),iv=buf.subarray(23,35),tag=buf.subarray(35,51),body=buf.subarray(51),key=crypto.scryptSync(password,salt,32),decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8');}
function writeBackupFile(dest,data,encrypt,password){fs.mkdirSync(dest,{recursive:true});const stamp=new Date().toISOString().replace(/[:.]/g,'-'),ext=encrypt?'.vccrbak':'-backup.json',fileName=`Vintage-Classic-Vehicle-Records-${stamp}${ext}`,full=path.join(dest,fileName),out=encrypt?encryptText(data,password):Buffer.from(data,'utf8');fs.writeFileSync(full,out);const verify=fs.readFileSync(full);return{fileName,path:full,verified:checksum(out)===checksum(verify),size:verify.length};}
function pruneDestination(dest,retention){try{const files=fs.readdirSync(dest).filter(f=>f.startsWith('Vintage-Classic-Vehicle-Records-')).map(f=>({f,t:fs.statSync(path.join(dest,f)).mtimeMs})).sort((a,b)=>b.t-a.t);files.slice(retention).forEach(x=>fs.unlinkSync(path.join(dest,x.f)));}catch{}}

ipcMain.handle('storage:load',async()=>{try{return{ok:true,...readState()};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('storage:save',async(_e,state)=>{try{return writeState(state);}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('storage:create-recovery',async(_e,state)=>{try{ensureDirs();fs.writeFileSync(recoveryPath,JSON.stringify({created:new Date().toISOString(),state},null,2));return{ok:true,path:recoveryPath};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('storage:recovery-status',async()=>{try{if(!fs.existsSync(recoveryPath))return{available:false};const r=JSON.parse(fs.readFileSync(recoveryPath,'utf8'));return{available:true,created:r.created,path:recoveryPath};}catch(e){return{available:false,error:e.message};}});
ipcMain.handle('storage:restore-recovery',async()=>{try{const r=JSON.parse(fs.readFileSync(recoveryPath,'utf8'));writeState(r.state);return{ok:true,state:r.state};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('storage:integrity-check',async()=>{try{const result=db.exec('PRAGMA integrity_check');const value=result?.[0]?.values?.[0]?.[0]||'unknown';return{ok:value==='ok',result:value,databasePath:dbPath,size:fs.statSync(dbPath).size};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('asset:save-base64',async(_e,{dataUrl,category='Documents',fileName='asset'})=>{try{ensureDirs();const match=String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);if(!match)throw new Error('Invalid asset data');const ext=(match[1].split('/')[1]||'bin').replace('jpeg','jpg'),safe=String(fileName).replace(/[^a-z0-9._-]+/gi,'-'),name=`${Date.now()}-${safe.replace(/\.[^.]+$/,'')}.${ext}`,folder=category==='Photos'?'Photos':'Documents',full=path.join(appDataRoot(),'Assets',folder,name);fs.writeFileSync(full,Buffer.from(match[2],'base64'));return{ok:true,path:full,url:`file://${full.replace(/\\/g,'/')}`,size:fs.statSync(full).size};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('asset:open',async(_e,filePath)=>{try{await shell.openPath(filePath);return{ok:true};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('app:diagnostics',async()=>{const integrity=await (async()=>{try{const r=db.exec('PRAGMA integrity_check');return r?.[0]?.values?.[0]?.[0]||'unknown';}catch(e){return e.message;}})();return{version:app.getVersion(),electron:process.versions.electron,node:process.versions.node,platform:process.platform,arch:process.arch,databasePath:dbPath,databaseSize:fs.existsSync(dbPath)?fs.statSync(dbPath).size:0,integrity,userData:appDataRoot(),edition:'Collector Edition Professional',schemaVersion:6};});

ipcMain.handle('cloud:choose-folder',async()=>{const r=await dialog.showOpenDialog({properties:['openDirectory','createDirectory'],title:'Choose backup folder'});return r.canceled?{cancelled:true}:{cancelled:false,path:r.filePaths[0],name:path.basename(r.filePaths[0])};});
ipcMain.handle('cloud:backup-all',async(_e,payload)=>{try{const files=[];for(const d of payload.destinations||[]){const f=writeBackupFile(d.path,payload.data,!!payload.encrypt,payload.password||'');pruneDestination(d.path,Number(payload.retention||10));files.push({...f,destinationName:d.name});}return{ok:true,files};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('cloud:verify-backups',async(_e,paths)=>( {results:(paths||[]).map(p=>{try{const b=fs.readFileSync(p);return{path:p,ok:b.length>0,hash:checksum(b),size:b.length};}catch(e){return{path:p,ok:false,error:e.message};}})} ));
ipcMain.handle('cloud:choose-backup-file',async()=>{const r=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'Vehicle record backups',extensions:['json','vccrbak']}]});return{path:r.canceled?null:r.filePaths[0]};});
ipcMain.handle('cloud:read-backup',async(_e,{path:fp,password})=>{try{return{ok:true,data:decryptText(fs.readFileSync(fp),password||'')};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('cloud:safety-backup',async(_e,{data,reason})=>{try{const dir=path.join(appDataRoot(),'Safety Backups'),f=writeBackupFile(dir,data,false,'');return{ok:true,...f,reason};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('cloud:choose-portable-folder',async()=>{const r=await dialog.showOpenDialog({properties:['openDirectory','createDirectory']});return{path:r.canceled?null:r.filePaths[0]};});
ipcMain.handle('cloud:set-portable-path',async(_e,p)=>{portableDataPath=p||null;if(portableDataPath){await initDatabase();}return{ok:true,path:portableDataPath};});
ipcMain.on('cloud:backup-on-exit',(_e,payload)=>{try{for(const d of payload.destinations||[]){writeBackupFile(d.path,payload.data,!!payload.encrypt,payload.password||'');pruneDestination(d.path,Number(payload.retention||10));}}catch{}});

function copyRecursiveVerified(source,destination,manifest,relativeBase=''){
  if(!fs.existsSync(source)) return;
  const stat=fs.statSync(source);
  if(stat.isDirectory()){
    fs.mkdirSync(destination,{recursive:true});
    for(const name of fs.readdirSync(source)) copyRecursiveVerified(path.join(source,name),path.join(destination,name),manifest,path.join(relativeBase,name));
  }else{
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.copyFileSync(source,destination);
    const srcBuf=fs.readFileSync(source), dstBuf=fs.readFileSync(destination);
    const srcHash=checksum(srcBuf), dstHash=checksum(dstBuf);
    if(srcHash!==dstHash) throw new Error(`Verification failed for ${relativeBase||path.basename(source)}`);
    manifest.push({path:(relativeBase||path.basename(source)).replace(/\\/g,'/'),size:dstBuf.length,sha256:dstHash});
  }
}
function portableRuntimePath(){
  const candidates=[
    path.join(process.resourcesPath,'portable-runtime','Vintage Classic Vehicle Records Portable.exe'),
    path.join(app.getAppPath(),'bundled-portable','Vintage Classic Vehicle Records Portable.exe'),
    path.join(path.dirname(app.getAppPath()),'bundled-portable','Vintage Classic Vehicle Records Portable.exe')
  ];
  return candidates.find(fs.existsSync)||null;
}
ipcMain.handle('usb:choose-target',async()=>{
  const r=await dialog.showOpenDialog({title:'Choose USB or external drive folder',properties:['openDirectory','createDirectory']});
  if(r.canceled)return{cancelled:true};
  const target=r.filePaths[0];
  let freeBytes=null;
  try{const s=fs.statfsSync(target);freeBytes=s.bavail*s.bsize;}catch{}
  return{cancelled:false,path:target,name:path.basename(target)||target,freeBytes};
});
ipcMain.handle('usb:estimate',async()=>{
  try{
    ensureDirs();
    const runtime=portableRuntimePath();
    let total=runtime?fs.statSync(runtime).size:0;
    const walk=p=>{if(!fs.existsSync(p))return;const st=fs.statSync(p);if(st.isDirectory())for(const n of fs.readdirSync(p))walk(path.join(p,n));else total+=st.size;};
    for(const n of ['Data','Assets'])walk(path.join(appDataRoot(),n));
    return{ok:true,bytes:total,runtimeAvailable:!!runtime,runtimePath:runtime};
  }catch(e){return{ok:false,error:e.message};}
});
ipcMain.handle('usb:create-copy',async(_e,{targetFolder,folderName,includeBackups=true})=>{
  try{
    ensureDirs();persistDatabase();
    const runtime=portableRuntimePath();
    if(!runtime)throw new Error('The portable runtime is not bundled in this installed build. Rebuild the installer using Version 6.5.');
    const safeName=String(folderName||'Vintage Classic Vehicle Records').replace(/[<>:"/\\|?*]+/g,'-').trim()||'Vintage Classic Vehicle Records';
    const root=path.join(targetFolder,safeName);
    const temp=`${root}.creating`;
    fs.rmSync(temp,{recursive:true,force:true});fs.mkdirSync(temp,{recursive:true});
    const manifest=[];
    copyRecursiveVerified(runtime,path.join(temp,'Vintage Classic Vehicle Records.exe'),manifest,'Vintage Classic Vehicle Records.exe');
    for(const name of ['Data','Assets'])copyRecursiveVerified(path.join(appDataRoot(),name),path.join(temp,'Vintage Classic Vehicle Records Data',name),manifest,path.join('Vintage Classic Vehicle Records Data',name));
    if(includeBackups){for(const name of ['Recovery','Safety Backups'])copyRecursiveVerified(path.join(appDataRoot(),name),path.join(temp,'Vintage Classic Vehicle Records Data',name),manifest,path.join('Vintage Classic Vehicle Records Data',name));}
    fs.writeFileSync(path.join(temp,'PortableMode.ini'),'[PortableMode]\r\nEnabled=1\r\nDataFolder=Vintage Classic Vehicle Records Data\r\n','utf8');
    const marker=fs.readFileSync(path.join(temp,'PortableMode.ini'));manifest.push({path:'PortableMode.ini',size:marker.length,sha256:checksum(marker)});
    const info={product:'Vintage & Classic Vehicle Maintenance & Restoration Records – Collector Edition',version:app.getVersion(),created:new Date().toISOString(),sourceComputer:process.env.COMPUTERNAME||'Windows PC',files:manifest.length,totalBytes:manifest.reduce((a,x)=>a+x.size,0)};
    fs.writeFileSync(path.join(temp,'USB-COPY-INFO.json'),JSON.stringify(info,null,2));
    fs.writeFileSync(path.join(temp,'VERIFY-SHA256.json'),JSON.stringify({algorithm:'SHA-256',created:info.created,files:manifest},null,2));
    fs.writeFileSync(path.join(temp,'README - Portable USB Copy.txt'),`VINTAGE & CLASSIC VEHICLE RECORDS - PORTABLE USB COPY\r\n\r\nRun: Vintage Classic Vehicle Records.exe\r\nData folder: Vintage Classic Vehicle Records Data\r\n\r\nClose the application before removing the USB drive. Do not open the installed and portable copies at the same time when editing the same collection.\r\nCreated: ${info.created}\r\n`);
    fs.rmSync(root,{recursive:true,force:true});fs.renameSync(temp,root);
    return{ok:true,path:root,files:manifest.length,totalBytes:info.totalBytes,verified:true};
  }catch(e){return{ok:false,error:e.message};}
});
ipcMain.handle('usb:verify-copy',async(_e,root)=>{
  try{
    const mf=JSON.parse(fs.readFileSync(path.join(root,'VERIFY-SHA256.json'),'utf8'));
    const results=mf.files.map(x=>{try{const b=fs.readFileSync(path.join(root,...x.path.split('/')));return{path:x.path,ok:b.length===x.size&&checksum(b)===x.sha256};}catch(e){return{path:x.path,ok:false,error:e.message};}});
    return{ok:results.every(x=>x.ok),results};
  }catch(e){return{ok:false,error:e.message,results:[]};}
});
ipcMain.handle('usb:open-folder',async(_e,p)=>{const err=await shell.openPath(p);return{ok:!err,error:err||null};});

function getJson(url){return new Promise((resolve,reject)=>{https.get(url,{headers:{'User-Agent':'VintageClassicVehicleRecords/7.0','Accept':'application/vnd.github+json'}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{if(res.statusCode>=400)throw new Error(`GitHub returned ${res.statusCode}`);resolve(JSON.parse(data));}catch(e){reject(e);}});}).on('error',reject);});}
function downloadFile(url,dest,onProgress){return new Promise((resolve,reject)=>{const request=https.get(url,{headers:{'User-Agent':'VintageClassicVehicleRecords/7.1','Accept':'application/octet-stream'}},res=>{if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();return downloadFile(res.headers.location,dest,onProgress).then(resolve,reject);}if(res.statusCode!==200){res.resume();return reject(new Error(`Download failed with HTTP ${res.statusCode}`));}const total=Number(res.headers['content-length']||0);let transferred=0;const out=fs.createWriteStream(dest);res.on('data',chunk=>{transferred+=chunk.length;onProgress?.(total?Math.min(100,transferred/total*100):0,transferred,total);});res.on('error',reject);out.on('error',reject);out.on('finish',()=>{out.close();resolve(dest);});res.pipe(out);});request.on('error',reject);});}
ipcMain.handle('app:open-bug-report',async()=>{try{createBugReportWindow();return{ok:true};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('app:open-bug-report',async()=>{try{createBugReportWindow();return{ok:true};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('app:open-external',async(_e,url)=>{if(!/^https:\/\//i.test(String(url)))return{ok:false,error:'Only secure web links are allowed'};await shell.openExternal(url);return{ok:true};});
ipcMain.handle('app:check-updates',async()=>{try{const r=await getJson('https://api.github.com/repos/DelboyGames/vintage-classic-car-records/releases/latest');const latest=String(r.tag_name||r.name||'').replace(/^v/i,'');const asset=(r.assets||[]).find(a=>/portable.*\.exe$/i.test(a.name)||/portable.*\.exe/i.test(a.name));if(!isPortableMode){try{await autoUpdater.checkForUpdates();}catch{}}return{ok:true,current:app.getVersion(),latest,url:r.html_url,name:r.name,published:r.published_at,portable:isPortableMode,portableAsset:asset?.browser_download_url||null,releaseApi:r.url};}catch(e){return{ok:false,current:app.getVersion(),error:e.message,portable:isPortableMode};}});
ipcMain.handle('app:create-bug-report',async(_e,payload)=>{try{const d=payload.includeDiagnostics?await (async()=>{const result=db.exec('PRAGMA integrity_check');return{appVersion:app.getVersion(),electron:process.versions.electron,windows:`${process.platform} ${process.arch}`,integrity:result?.[0]?.values?.[0]?.[0]||'unknown',schema:6};})():null;const body=[`## Description\n${payload.description||''}`,`## Steps to reproduce\n${payload.steps||''}`,`## Expected result\n${payload.expected||''}`,`## Actual result\n${payload.actual||''}`,d?`## Diagnostics\n\`\`\`json\n${JSON.stringify(d,null,2)}\n\`\`\``:'',`## Privacy confirmation\nNo vehicle records, photographs, documents, addresses, registration numbers or database files are attached automatically.`].filter(Boolean).join('\n\n');const params=new URLSearchParams({title:`[Bug] ${payload.title||'Issue in Collector Edition'}`,body,labels:'bug'});const url=`https://github.com/DelboyGames/vintage-classic-car-records/issues/new?${params.toString()}`;await shell.openExternal(url);return{ok:true,url};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('vehicle:open-window',async(_e,vehicleId)=>{try{if(!vehicleId)throw new Error('Vehicle ID is required');createVehicleWindow(String(vehicleId));return{ok:true};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('app:update-install',async()=>{
  try{
    if(!isPortableMode){
      if(!app.isPackaged)return{ok:false,error:'Updates are only available in the installed build.'};
      await autoUpdater.downloadUpdate();
      return{ok:true,mode:'installed',downloadStarted:true};
    }
    const release=await getJson('https://api.github.com/repos/DelboyGames/vintage-classic-car-records/releases/latest');
    const latest=String(release.tag_name||release.name||'').replace(/^v/i,'');
    if(!latest || latest===app.getVersion())return{ok:true,mode:'none',message:'No Update Available'};
    const asset=(release.assets||[]).find(a=>/portable.*\.exe$/i.test(a.name));
    if(!asset)throw new Error('No portable EXE was found in the latest GitHub release.');
    const temp=path.join(app.getPath('temp'),`Vintage-Classic-Vehicle-Records-${latest}-portable-update.exe`);
    await downloadFile(asset.browser_download_url,temp,(percent,transferred,total)=>mainWindow?.webContents.send('updates:progress',{percent,transferred,total,bytesPerSecond:0,mode:'portable'}));
    const current=process.execPath;
    const script=path.join(app.getPath('temp'),`vcc-update-${Date.now()}.cmd`);
    const cmd=`@echo off\r\ntimeout /t 2 /nobreak >nul\r\ncopy /Y "${temp}" "${current}" >nul\r\nstart "" "${current}"\r\ndel /f /q "${temp}" >nul 2>&1\r\ndel /f /q "%~f0" >nul 2>&1\r\n`;
    fs.writeFileSync(script,cmd,'utf8');
    require('child_process').spawn('cmd.exe',['/c',script],{detached:true,stdio:'ignore',windowsHide:true}).unref();
    setTimeout(()=>app.quit(),300);
    return{ok:true,mode:'portable',downloadStarted:true,version:latest};
  }catch(e){return{ok:false,error:e.message};}
});
ipcMain.handle('app:update-quit-and-install',async()=>{try{if(isPortableMode)return{ok:false,error:'Portable update is already staged.'};autoUpdater.quitAndInstall(false,true);return{ok:true};}catch(e){return{ok:false,error:e.message};}});
ipcMain.handle('collector:generate-qr',async(_e,text)=>QRCode.toDataURL(String(text),{errorCorrectionLevel:'M',margin:2,width:320}));

app.whenReady().then(async()=>{portableAutoRoot=detectPortableRoot();isPortableMode=!!portableAutoRoot || !!process.env.PORTABLE_EXECUTABLE_DIR;app.setAppUserModelId('personal.vintageClassicVehicleRecordsCollector');await initDatabase();buildMenu();createWindow();setupAutoUpdater();scheduleStartupUpdateCheck();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
