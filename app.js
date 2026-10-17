const refs = new Set();
const scanned = new Set();
let history = JSON.parse(localStorage.getItem("ean13-history") || "[]");
let stream = null, scanning = false, detector = null;\nlet scanCooldownUntil = 0;\nlet audioCtx = null;

const $ = id => document.getElementById(id);
const fileInput=$("fileInput"), fileName=$("fileName"), fileStatus=$("fileStatus");
const historyEl=$("history"), countEl=$("count"), resultEl=$("result");
const video=$("video"), placeholder=$("scanPlaceholder");

function validEAN13(s){return /^\d{13}$/.test(s)}
function statusFor(code){
  if(!refs.has(code)) return ["unknown","INCONNU"];
  if(scanned.has(code)) return ["duplicate","DOUBLON"];
  scanned.add(code);
  return ["ok","OK"];
}
function renderHistory(){
  countEl.textContent=history.length;
  if(!history.length){historyEl.innerHTML='<div class="empty">Aucun scan pour le moment.</div>';return}
  historyEl.innerHTML=history.map(x=>`
    <div class="row">
      <span class="dot ${x.cls}"></span>
      <span class="code ${x.cls}">${x.code}</span>
      <span class="badge ${x.cls}">${x.cls==="ok"?"✓ OK":x.cls==="unknown"?"✕ INCONNU":"▣ DOUBLON"}</span>
    </div>`).join("");
}

function ensureAudio(){
  try{
    if(!audioCtx){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if(Ctx) audioCtx = new Ctx();
    }
    if(audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }catch(e){}
}

function beep(type){
  ensureAudio();
  if(!audioCtx) return;

  const now = audioCtx.currentTime;
  const gain = audioCtx.createGain();
  gain.connect(audioCtx.destination);
  gain.gain.setValueAtTime(0.0001, now);

  const tone = (freq, start, duration, volume=0.07, wave="sine") => {
    const osc = audioCtx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, now + start);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, now + start);
    g.gain.exponentialRampToValueAtTime(volume, now + start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(now + start);
    osc.stop(now + start + duration + 0.02);
  };

  if(type === "ok"){
    tone(880, 0, 0.10, 0.08, "sine");
    tone(1320, 0.12, 0.13, 0.08, "sine");
  }else if(type === "unknown"){
    tone(260, 0, 0.18, 0.09, "square");
  }else if(type === "duplicate"){
    tone(520, 0, 0.10, 0.07, "triangle");
    tone(520, 0.13, 0.10, 0.07, "triangle");
  }
}

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
  beep(cls);
}
function showResult(msg,cls){
  resultEl.textContent=msg;
  resultEl.className="result "+cls;
  resultEl.classList.remove("flash"); void resultEl.offsetWidth; resultEl.classList.add("flash");
}
fileInput.addEventListener("change", async e=>{
  const f=e.target.files[0]; if(!f)return;
  fileName.textContent=f.name;
  const text=await f.text();
  refs.clear();
  text.split(/\r?\n/).forEach(line=>{const code=line.trim().replace(/\D/g,"");if(validEAN13(code))refs.add(code)});
  fileStatus.textContent=`${refs.size} EAN13 de référence chargés.`;
});
$("verifyBtn").addEventListener("click",()=>verify($("manualInput").value));
$("manualInput").addEventListener("keydown",e=>{if(e.key==="Enter")verify(e.target.value)});

async function startCamera(){
  try{
    stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{exact:"environment"},width:{ideal:1280},height:{ideal:720}},
      audio:false
    }).catch(async ()=>{
      return await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:"environment"}},
        audio:false
      });
    });
    video.srcObject=stream; await video.play(); video.style.display="block"; placeholder.style.display="none";\n    scanCooldownUntil = 0;\n    ensureAudio();
    $("startCamera").classList.add("hidden");$("stopCamera").classList.remove("hidden");scanning=true;
    if("BarcodeDetector" in window){
      const formats=await BarcodeDetector.getSupportedFormats();
      const eanFormats=formats.filter(f=>f==="ean_13"||f==="ean-13");
      detector=eanFormats.length ? new BarcodeDetector({formats:eanFormats}) : null;
      if(detector) scanLoop();
      else showResult("Détection EAN13 non disponible sur ce navigateur. Utilisez la saisie manuelle.","unknown");
    }else showResult("Détection EAN13 non disponible sur ce navigateur. Utilisez la saisie manuelle.","unknown");
  }catch(err){showResult("Impossible d'accéder à la caméra. Vérifiez l’autorisation.","unknown")}
}
async function scanLoop(){
  if(!scanning||!detector)return;
  try{
    const now = Date.now();
    if(now >= scanCooldownUntil){
      const codes=await detector.detect(video);
      if(codes.length&&codes[0].rawValue){
        verify(codes[0].rawValue);
        // Pause automatic scanning briefly so the same barcode cannot be
        // registered repeatedly while it remains in front of the camera.
        scanCooldownUntil = Date.now() + 2500;
      }
    }
  }catch(e){}
  requestAnimationFrame(scanLoop);
}
function stopCamera(){
  scanning=false;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.style.display="none";placeholder.style.display="flex";
  $("startCamera").classList.remove("hidden");$("stopCamera").classList.add("hidden");
}
$("startCamera").addEventListener("click",startCamera);
$("stopCamera").addEventListener("click",stopCamera);
function xmlEscape(value){
  return String(value)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&apos;");
}

function exportExcel(){
  const scannedHistory = history.slice().reverse();
  const unscanned = [...refs].filter(code => !scanned.has(code));

  const rows = [];
  rows.push(`
    <Row>
      <Cell ss:StyleID="Header"><Data ss:Type="String">Historique de scan</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">Références manquantes</Data></Cell>
    </Row>`);

  const maxRows = Math.max(scannedHistory.length, unscanned.length, 1);

  for(let i=0;i<maxRows;i++){
    const scan = scannedHistory[i];
    const missing = unscanned[i];

    let scanCell = `<Cell><Data ss:Type="String"></Data></Cell>`;
    if(scan){
      const style = scan.cls === "ok" ? "OK" :
                    scan.cls === "unknown" ? "Unknown" : "Duplicate";
      const label = scan.cls === "ok" ? "OK" :
                    scan.cls === "unknown" ? "INCONNU" : "DOUBLON";
      scanCell = `<Cell ss:StyleID="${style}"><Data ss:Type="String">${xmlEscape(scan.code)} — ${label}</Data></Cell>`;
    }

    const missingCell = missing
      ? `<Cell ss:StyleID="Missing"><Data ss:Type="String">${xmlEscape(missing)}</Data></Cell>`
      : `<Cell><Data ss:Type="String"></Data></Cell>`;

    rows.push(`<Row>${scanCell}${missingCell}</Row>`);
  }

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#17365D" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="OK">
   <Font ss:Color="#008000" ss:Bold="1"/>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Unknown">
   <Font ss:Color="#C00000" ss:Bold="1"/>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Duplicate">
   <Font ss:Color="#C65911" ss:Bold="1"/>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Missing">
   <Font ss:Color="#7F6000" ss:Bold="1"/>
   <Interior ss:Color="#FFF2CC" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Contrôle EAN13">
  <Table>
   <Column ss:Width="220"/>
   <Column ss:Width="180"/>
   ${rows.join("")}
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], {type:"application/vnd.ms-excel"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `controle-EAN13-${date}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

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