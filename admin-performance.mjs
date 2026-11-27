// Local, opt-in diagnostics. Only fixed labels, durations, counts and byte sizes are retained.
export function adminPerformance() {
 const enabled=new URLSearchParams(location.search).get('mesure')==='1';
 if(!enabled)return {ready(){},response(){},reset(){}};
 let started=performance.now(),panel;
 const durations=new Map(),responses=new Map();

 function update() {
  const workspace=document.getElementById('workspace')||document.getElementById('admin');
  if(!workspace)return;
  if(!panel){
   panel=document.createElement('details');
   const title=document.createElement('summary');
   title.textContent='Mesures de performance locales';
   const output=document.createElement('pre');
   output.style.whiteSpace='pre-wrap';
   panel.append(title,output);
   workspace.prepend(panel);
  }
  const elapsed=Math.round((performance.now()-started)/1000);
  panel.lastElementChild.textContent=[
   'Session de mesure · '+elapsed+' s écoulées',
   ...[...durations].map(([label,ms])=>label+' · '+ms+' ms'),
   ...[...responses].map(([label,{count,bytes}])=>label+' · '+count+' réponse(s) · '+bytes.toLocaleString('fr-FR')+' octets JSON')
  ].join('\n');
 }
 return {
  ready(label){
   if(durations.has(label))return;
   const ms=Math.round(performance.now()-started);
   durations.set(label,ms);
   performance.measure('km16:'+label,{start:started,duration:ms});
   update();
  },
  response(label,value){
   const previous=responses.get(label)||{count:0,bytes:0};
   previous.count++;
   previous.bytes+=new TextEncoder().encode(JSON.stringify(value??null)).length;
   responses.set(label,previous);
   update();
  },
  reset(){
   started=performance.now();
   for(const label of durations.keys())performance.clearMeasures('km16:'+label);
   durations.clear();responses.clear();update();
  }
 };
}
