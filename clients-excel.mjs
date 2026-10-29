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
const headers=['Nom','Prénom','Adresse de facturation','E-mail','Téléphone','Produits achetés','Représentant légal','Nom de facturation'];
const productText=c=>c.products.map(p=>p.title+(p.state==='Acheté'?'':' ['+p.state+']')).join('\n');
export function clientsWorkbook(clients){
 if(clients.some(c=>!groups.includes(c.group)))throw Error('Un dossier est hors des trois groupes : vérifiez son âge avant l’export');
 const files=[];
 const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 files.push(['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+groups.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>']);
 files.push(['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
 files.push(['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="'+main+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+groups.map((g,i)=>'<sheet name="'+g+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>']);
 files.push(['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+groups.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>']);
 files.push(['xl/styles.xml','<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="'+main+'"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB31C28"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']);
 groups.forEach((group,i)=>{
  const rows=[headers,...clients.filter(c=>c.group===group).map(c=>[c.last_name,c.first_name,c.address.join('\n'),c.email,c.phone,productText(c),c.guardian_name,c.billing_name])];
  const widths=[22,22,42,36,20,65,28,28];
  const data=rows.map((row,index)=>'<row r="'+(index+1)+'"'+(index===0?' ht="30" customHeight="1"':'')+'>'+row.map((value,col)=>'<c r="'+String.fromCharCode(65+col)+(index+1)+'" t="inlineStr" s="'+(index===0?1:0)+'"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>').join('')+'</row>').join('');
  files.push(['xl/worksheets/sheet'+(i+1)+'.xml','<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="'+main+'"><dimension ref="A1:H'+rows.length+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+widths.map((width,c)=>'<col min="'+(c+1)+'" max="'+(c+1)+'" width="'+width+'" customWidth="1"/>').join('')+'</cols><sheetData>'+data+'</sheetData><autoFilter ref="A1:H'+rows.length+'"/></worksheet>']);
 });
 return zip(files);
}
