const embedded=new URLSearchParams(location.search).get('embed')==='1'&&parent!==window;
if(embedded){
 document.body.classList.add('payment-embed');
 for(const a of document.querySelectorAll('a[href^="./#"]'))a.target='_top';
 const resize=()=>parent.postMessage({type:'km16-payment-height',height:document.body.getBoundingClientRect().height+16},location.origin);
 new ResizeObserver(resize).observe(document.body);addEventListener('load',resize);document.addEventListener('km16-payment-ready',()=>{parent.postMessage({type:'km16-payment-ready'},location.origin);resize();});resize();
}
