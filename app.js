const refs = new Set();
const scanned = new Set();
let history = JSON.parse(localStorage.getItem("ean13-history") || "[]");
history.forEach(x => scanned.add(x.code));
let stream = null, scanning = false, detector = null;
let cameraZoomed = false;
let scanCooldownUntil = 0;
let scanTimer = null;
let cameraIdleTimer = null;
const CAMERA_IDLE_MS = 30000;
let audioCtx = null;
let voiceReady = false;
let scanCanvas = null;
let scanCtx = null;
let sourceFileBaseName = "controle-EAN13";

const $ = id => document.getElementById(id);
const fileInput=$("fileInput"), fileName=$("fileName"), fileStatus=$("fileStatus");
const historyEl=$("history"), countEl=$("count"), resultEl=$("result");
const video=$("video"), placeholder=$("scanPlaceholder");

function validEAN13(s){return /^\d{13}$/.test(s)}
function statusFor(code){
  const alreadyScanned = scanned.has(code);
  const known = refs.has(code);

  if(alreadyScanned && !known) return ["duplicate-unknown","DOUBLON-INCONNU"];
  if(alreadyScanned && known) return ["duplicate","DOUBLON"];

  scanned.add(code);
  if(!known) return ["unknown","INCONNU"];
  return ["ok","OK"];
}
function renderHistory(){
  countEl.textContent=history.length;
  if(!history.length){historyEl.innerHTML='<div class="empty">Aucun scan pour le moment.</div>';return}
  historyEl.innerHTML=history.map(x=>`
    <div class="row">
      <span class="dot ${x.cls}"></span>
      <span class="code ${x.cls}">${x.code}</span>
      <span class="badge ${x.cls}">${x.cls==="ok"?"✓ OK":x.cls==="unknown"?"✕ INCONNU":x.cls==="duplicate-unknown"?"▣ DOUBLON-INCONNU":"▣ DOUBLON"}</span>
    </div>`).join("");
}

function speakResult(type){
  try{
    if(!('speechSynthesis' in window)) return;
    const text = type === "ok" ? "OK" : type === "unknown" ? "Inconnu" : type === "duplicate-unknown" ? "Doublon-Inconnu" : "Doublon";
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const frenchVoice = voices.find(v => /^fr(-|_)/i.test(v.lang));
    if(frenchVoice) utterance.voice = frenchVoice;
    window.speechSynthesis.speak(utterance);
    voiceReady = true;
  }catch(e){}
}

function unlockVoice(){
  try{
    if(!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance("");
    utterance.lang = "fr-FR";
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
    voiceReady = true;
  }catch(e){}
}

if('speechSynthesis' in window){
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

function speechResultFallback(type){ speakResult(type); }

function verify(code){
  code=String(code).replace(/\D/g,"");
  $("manualInput").value=code;
  if(!validEAN13(code)){showResult("EAN13 invalide : 13 chiffres requis.","unknown");return}
  const [cls,label]=statusFor(code);
  history.unshift({code,cls});
  localStorage.setItem("ean13-history",JSON.stringify(history));
  $("manualInput").value = "";
  renderHistory();
  showResult(`${code} — ${label}`,cls);
  try{speechResultFallback(cls)}catch(e){}
}
function showResult(msg,cls){
  resultEl.textContent=msg;
  resultEl.className="result "+cls;
  resultEl.classList.remove("flash"); void resultEl.offsetWidth; resultEl.classList.add("flash");
}
fileInput.addEventListener("change", async e=>{
  const f=e.target.files[0]; if(!f)return;
  fileName.textContent=f.name;
  sourceFileBaseName = f.name.replace(/\.[^.]+$/, "").trim() || "controle-EAN13";
  const text=await f.text();
  refs.clear();
  text.split(/\r?\n/).forEach(line=>{const code=line.trim().replace(/\D/g,"");if(validEAN13(code))refs.add(code)});
  fileStatus.textContent=`${refs.size} EAN13 de référence chargés.`;
});
$("verifyBtn").addEventListener("click",()=>{unlockVoice(); verify($("manualInput").value)});
$("manualInput").addEventListener("keydown",e=>{if(e.key==="Enter")verify(e.target.value)});

async function startCamera(){
  if(refs.size === 0){
    showResult("Veuillez d’abord charger un fichier TXT avant de démarrer le scanner.","unknown");
    return;
  }
  try{
    unlockVoice();
    stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{exact:"environment"},width:{ideal:1280},height:{ideal:720}},
      audio:false
    }).catch(async ()=>{
      return await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:"environment"}},
        audio:false
      });
    });
    video.srcObject=stream; await video.play(); video.style.display="block"; placeholder.style.display="none"; scanCooldownUntil=0;
    $("startCamera").classList.add("hidden");$("stopCamera").classList.remove("hidden");scanning=true;
    resetCameraIdleTimer();
    if("BarcodeDetector" in window){
      const formats=await BarcodeDetector.getSupportedFormats();
      const eanFormats=formats.filter(f=>f==="ean_13"||f==="ean-13");
      detector=eanFormats.length ? new BarcodeDetector({formats:eanFormats}) : null;
      if(detector) scanLoop();
      else showResult("Détection EAN13 non disponible sur ce navigateur. Utilisez la saisie manuelle.","unknown");
    }else showResult("Détection EAN13 non disponible sur ce navigateur. Utilisez la saisie manuelle.","unknown");
  }catch(err){showResult("Impossible d'accéder à la caméra. Vérifiez l’autorisation.","unknown")}
}
function resetCameraIdleTimer(){
  clearTimeout(cameraIdleTimer);
  if(!scanning) return;
  cameraIdleTimer=setTimeout(()=>{
    stopCamera();
    showResult("Scanner arrêté après 30 s sans scan pour économiser la batterie.","unknown");
  },CAMERA_IDLE_MS);
}
async function scanLoop(){
  if(!scanning||!detector)return;
  try{
    if(video.videoWidth && video.videoHeight && Date.now() >= scanCooldownUntil){
      // Le détecteur peut voir toute l'image, mais un résultat n'est accepté
      // que si le centre du code est exactement dans la bande de la ligne rouge.
      const codes=await detector.detect(video);
      const centerMin=0.44, centerMax=0.56;
      const match=codes.find(code=>{
        if(!code.rawValue || !code.boundingBox) return false;
        const box=code.boundingBox;
        const centerY=box.y+(box.height/2);
        const normalized=centerY/video.videoHeight;
        return normalized>=centerMin && normalized<=centerMax;
      });
      if(match){
        verify(match.rawValue);
        scanCooldownUntil=Date.now()+2500;
        resetCameraIdleTimer();
      }
    }
  }catch(e){}
  if(scanning) scanTimer=setTimeout(scanLoop,220);
}
function stopCamera(){
  cameraZoomed=false;
  scanning=false;scanCooldownUntil=0;clearTimeout(scanTimer);clearTimeout(cameraIdleTimer);scanTimer=null;cameraIdleTimer=null;
  if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;video.style.display="none";placeholder.style.display="flex";
  $("startCamera").classList.remove("hidden");$("stopCamera").classList.add("hidden");
}
async function toggleCameraZoom(){
  if(!stream || !scanning) return;
  const track = stream.getVideoTracks()[0];
  if(!track) return;

  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  if(!("zoom" in capabilities)){
    showResult("Le zoom caméra ×3 n’est pas disponible sur cet appareil.","unknown");
    return;
  }

  const min = Number.isFinite(capabilities.zoom?.min) ? capabilities.zoom.min : 1;
  const max = Number.isFinite(capabilities.zoom?.max) ? capabilities.zoom.max : 3;
  const target = cameraZoomed ? min : Math.min(3, max);

  try{
    await track.applyConstraints({advanced:[{zoom:target}]});
    cameraZoomed = !cameraZoomed;
    showResult(cameraZoomed ? "Zoom caméra ×3 activé." : "Zoom caméra normal.", "ok");
  }catch(e){
    showResult("Impossible de modifier le zoom de la caméra.","unknown");
  }
}

$("startCamera").addEventListener("click",startCamera);
$("stopCamera").addEventListener("click",stopCamera);
$("scanner").addEventListener("dblclick",toggleCameraZoom);

function xmlEscape(value){
  return String(value)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&apos;");
}

function exportExcel(){
  const unscanned = [...refs].filter(code => !scanned.has(code));
  const unknowns = [...new Set(
    history
      .filter(x => x.cls === "unknown" || x.cls === "duplicate-unknown")
      .map(x => x.code)
  )];

  const rows = [];
  rows.push(`
    <Row>
      <Cell ss:StyleID="Header"><Data ss:Type="String">EAN13 manquants</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">Inconnus</Data></Cell>
    </Row>`);

  const maxRows = Math.max(unscanned.length, unknowns.length, 1);

  for(let i=0;i<maxRows;i++){
    const missingCell = unscanned[i]
      ? `<Cell ss:StyleID="Missing"><Data ss:Type="String">${xmlEscape(unscanned[i])}</Data></Cell>`
      : `<Cell><Data ss:Type="String"></Data></Cell>`;

    const unknownCell = unknowns[i]
      ? `<Cell ss:StyleID="Unknown"><Data ss:Type="String">${xmlEscape(unknowns[i])}</Data></Cell>`
      : `<Cell><Data ss:Type="String"></Data></Cell>`;

    rows.push(`<Row>${missingCell}${unknownCell}</Row>`);
  }

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="center"/>
   <Font ss:FontName="Calibri" ss:Size="11"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#17365D" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Unknown">
   <Font ss:Color="#C00000" ss:Bold="1"/>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Missing">
   <Font ss:Color="#7F6000" ss:Bold="1"/>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Contrôle EAN13">
  <Table>
   <Column ss:Width="180"/>
   <Column ss:Width="180"/>
   ${rows.join("")}
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], {type:"application/vnd.ms-excel"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeBase = sourceFileBaseName.replace(/[^a-zA-Z0-9À-ÿ _.-]/g, "_").replace(/\s+/g, " ").trim() || "controle-EAN13";
  a.download = `1er contrôle - ${safeBase}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function resetControl(){
  stopCamera();
  history=[];
  scanned.clear();
  localStorage.removeItem("ean13-history");
  renderHistory();
  showResult("Historique effacé. Le fichier TXT reste chargé.","ok");
}
$("resetBtn").addEventListener("click",()=>{
  if(confirm("Effacer l’historique et réinitialiser le contrôle sans créer de fichier Excel ?")){
    resetControl();
  }
});

$("finishBtn").addEventListener("click",()=>{
  if(confirm("Terminer le contrôle et créer le fichier Excel ?")){
    exportExcel();
    stopCamera();
    history=[];
    scanned.clear();
    localStorage.removeItem("ean13-history");
    renderHistory();
    showResult("Contrôle terminé — fichier Excel créé.","ok");
  }
});
renderHistory();