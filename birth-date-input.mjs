// Display French dates while keeping ISO values for age checks and API requests.
export function enhanceBirthDate(input){
 if(!input||input.dataset.dateEnhanced)return;
 input.dataset.dateEnhanced='1';
 const field=document.createElement('input');
 field.id=input.id+'-display';field.type='text';field.inputMode='numeric';
 field.autocomplete='bday';field.placeholder='JJ/MM/AAAA';field.maxLength=10;
 field.required=input.required;field.pattern='[0-9]{2}/[0-9]{2}/[0-9]{4}';
 for(const attr of ['aria-label','aria-describedby'])if(input.hasAttribute(attr))field.setAttribute(attr,input.getAttribute(attr));
 for(const label of input.labels||[])if(label.htmlFor===input.id)label.htmlFor=field.id;
 const french=iso=>/^\d{4}-\d{2}-\d{2}$/.test(iso)?iso.slice(8)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4):'';
 const initial=input.value;field.value=french(initial);field.defaultValue=field.value;input.type='hidden';input.required=false;input.after(field);
 function sync(){
  const value=field.value;let iso='',error='';
  if(value){
   const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
   if(m){const candidate=m[3]+'-'+m[2]+'-'+m[1];const date=new Date(candidate+'T12:00:00Z');
    if(Number(m[3])>=1000&&!Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===candidate)iso=candidate;
   }
   if(!iso)error='Saisissez une date valide au format JJ/MM/AAAA.';
  }
  field.setCustomValidity(error);input.value=iso;input.dispatchEvent(new Event('change',{bubbles:true}));
 }
 field.addEventListener('input',()=>{
  let raw=field.value,position=field.selectionStart||0;
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){raw=french(raw);position=raw.length;}
  const digits=raw.replace(/\D/g,'').slice(0,8),before=raw.slice(0,position).replace(/\D/g,'').length;
  let formatted=digits.slice(0,2);if(digits.length>=2)formatted+='/'+digits.slice(2,4);if(digits.length>=4)formatted+='/'+digits.slice(4);
  field.value=formatted;
  let caret=0,count=0;while(caret<formatted.length&&count<before){if(/\d/.test(formatted[caret]))count++;caret++;}while(formatted[caret]==='/')caret++;
  field.setSelectionRange(caret,caret);sync();
 });
 field.addEventListener('keydown',e=>{
  const at=field.selectionStart;if(at!==field.selectionEnd)return;
  if(e.key==='Backspace'&&field.value[at-1]==='/')field.setSelectionRange(Math.max(0,at-2),at);
  if(e.key==='Delete'&&field.value[at]==='/')field.setSelectionRange(at,at+2);
 });
 input.form?.addEventListener('reset',()=>queueMicrotask(()=>{input.value=initial;field.value=french(initial);sync();}));
 return field;
}
