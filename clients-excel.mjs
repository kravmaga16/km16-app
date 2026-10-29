// Export XLSX local, sans envoi des données à un service de tableur.
const encoder=new TextEncoder();
const xml=s=>String(s??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function crc32(data){let crc=-1;for(const b of data){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^-1)>>>0;}
function zip(files){
 const chunks=[],central=[];let offset=0,centralSize=0;
 for(const [filename,text] of files){
  const name=encoder.encode(filename),data=encoder.encode(text),crc=crc32(data);
  const local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);
  v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);local.set(name,30);
  const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);
  cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);
  cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);c.set(name,46);
  chunks.push(local,data);central.push(c);offset+=local.length+data.length;centralSize+=c.length;
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
 const result=new Uint8Array(offset+centralSize+22);let at=0;for(const c of [...chunks,...central,end]){result.set(c,at);at+=c.length;}return result;
}

const groups=['Enfants','Ados','Adultes'];
const moneyKeys=['total_cents','gross_cents','refunded_cents','net_cents','future_cents','planned_cents','overdue_cents','cancelled_cents','disputed_cents'];
const moneyLabels=['Achats (€)','Encaissé brut (€)','Remboursé (€)','Encaissé net (€)','Échéances futures (€)','CA planifié (€)','Échues impayées (€)','Échéances annulées (€)','Montants contestés inclus dans le net (€)'];
const headers=['Nom','Prénom','Adresse de facturation','E-mail','Téléphone','Produits achetés','Représentant légal','Nom de facturation',...moneyLabels,'Vérification prévision'];
const euros=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(n/100);
const productText=c=>c.products.map(p=>p.title+' · '+euros(p.total_cents)+(p.state==='Acheté'?'':' ['+p.state+']')).join('\n');
const sums=rows=>[...moneyKeys.map(k=>rows.reduce((n,c)=>n+(c.amounts?.[k]||0),0)/100),rows.some(c=>c.forecast_unknown)?'PARTIEL · dossiers à vérifier':'Vérifiée'];
export function clientsWorkbook(clients,all=clients){
 if([...clients,...all].some(c=>!groups.includes(c.group)))throw Error('Un dossier est hors des trois groupes : vérifiez son âge avant l’export');
 const sheets=groups.map(group=>({name:group,rows:[headers,...clients.filter(c=>c.group===group).map(c=>[c.last_name,c.first_name,c.address.join('\n'),c.email,c.phone,productText(c),c.guardian_name,c.billing_name,...moneyKeys.map(k=>c.forecast_unknown&&['future_cents','planned_cents','overdue_cents','cancelled_cents'].includes(k)?'À vérifier':(c.amounts?.[k]||0)/100),c.forecast_unknown?'À vérifier':'Vérifiée'])],widths:[22,22,42,36,20,65,28,28,...moneyKeys.map(()=>24),28],moneyStart:8}));
 sheets.push({name:'Synthèse',moneyStart:1,widths:[65,...moneyKeys.map(()=>25),32],rows:[['Périmètre',...moneyLabels,'Vérification prévision'],['GLOBAL · tous les dossiers de cet environnement',...sums(all)],...groups.map(g=>['Global · '+g,...sums(all.filter(c=>c.group===g))]),['SÉLECTION · recherche en cours, tous groupes',...sums(clients)],...groups.map(g=>['Sélection · '+g,...sums(clients.filter(c=>c.group===g))]),['CA planifié = encaissé net + futur vérifié. Échues impayées et annulées exclues du futur.'],['Toute prévision partielle est signalée et ne doit pas être interprétée comme un total définitif.'],['Contestations incluses dans le net et signalées séparément.'],['Achats du parcours adhésion uniquement. Aucune importation Fighty ou vente du module vidéos.'],['Export figé à sa date de téléchargement ; ce suivi ne remplace pas la comptabilité.']]});
 const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/package/2006/relationships',docrel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const files=[['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'],
 ['_rels/.rels','<Relationships xmlns="'+rel+'"><Relationship Id="rId1" Type="'+docrel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
 ['xl/workbook.xml','<workbook xmlns="'+main+'" xmlns:r="'+docrel+'"><sheets>'+sheets.map((s,i)=>'<sheet name="'+s.name+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>'],
 ['xl/_rels/workbook.xml.rels','<Relationships xmlns="'+rel+'">'+sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+docrel+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId5" Type="'+docrel+'/styles" Target="styles.xml"/></Relationships>'],
 ['xl/styles.xml','<styleSheet xmlns="'+main+'"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;€&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB31C28"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']];
 const col=n=>String.fromCharCode(65+n);
 sheets.forEach((s,i)=>{const last=col(s.widths.length-1),data=s.rows.map((row,r)=>'<row r="'+(r+1)+'">'+row.map((v,c)=>{const ref=col(c)+(r+1);return typeof v==='number'?'<c r="'+ref+'" s="2"><v>'+v+'</v></c>':'<c r="'+ref+'" t="inlineStr" s="'+(r===0?1:0)+'"><is><t xml:space="preserve">'+xml(v)+'</t></is></c>';}).join('')+'</row>').join('');
 files.push(['xl/worksheets/sheet'+(i+1)+'.xml','<worksheet xmlns="'+main+'"><dimension ref="A1:'+last+s.rows.length+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+s.widths.map((w,c)=>'<col min="'+(c+1)+'" max="'+(c+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols><sheetData>'+data+'</sheetData>'+(i<3?'<autoFilter ref="A1:'+last+s.rows.length+'"/>':'')+'</worksheet>']);});
 return zip(files);
}
