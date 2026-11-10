const bottom=document.querySelector('.bottom');
if(bottom){
 const original=[...bottom.querySelectorAll('[data-go]')];
 const primary=['accueil','planning','stages','tarifs'];
 const more=document.createElement('button');more.type='button';more.className='app-more-toggle';
 more.innerHTML='<b aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 6h14M5 12h14M5 18h14"/></svg></b>Plus';
 more.setAttribute('aria-haspopup','dialog');more.setAttribute('aria-controls','app-more-menu');more.setAttribute('aria-expanded','false');
 bottom.replaceChildren(...primary.map(id=>original.find(b=>b.dataset.go===id)),more);
 const dialog=document.createElement('dialog');dialog.id='app-more-menu';dialog.className='app-more-menu';dialog.setAttribute('aria-labelledby','app-more-title');
 const head=document.createElement('div');head.className='app-more-head';const title=document.createElement('h2');title.id='app-more-title';title.textContent='Toutes les rubriques';
 const close=document.createElement('button');close.type='button';close.className='app-more-close';close.textContent='Fermer';head.append(title,close);
 const account=document.createElement('a');account.className='app-member-entry';account.href='./adhesion.html?espace=1';
 const accountTitle=document.createElement('strong');accountTitle.textContent='Mon espace adhérent';const accountHint=document.createElement('span');accountHint.textContent='Mes inscriptions, mes stages et mes paiements';account.append(accountTitle,accountHint);
 const links=document.createElement('nav');links.setAttribute('aria-label','Autres rubriques');
 for(const button of original.filter(b=>!primary.includes(b.dataset.go))){button.className='app-more-link';if(button.dataset.go==='parametres')button.lastChild.textContent='Paramètres et notifications';links.append(button);}
 dialog.append(head,account,links);document.body.append(dialog);
 function mark(){const current=document.querySelector('.panel.active')?.id;const secondary=!primary.includes(current);more.setAttribute('aria-selected',String(secondary));for(const button of bottom.querySelectorAll('[data-go]'))button.setAttribute('aria-current',button.dataset.go===current?'page':'false');}
 function dismiss(){if(dialog.open)dialog.close();}
 more.onclick=()=>{dialog.showModal();more.setAttribute('aria-expanded','true');};close.onclick=dismiss;
 dialog.addEventListener('close',()=>{more.setAttribute('aria-expanded','false');more.focus({preventScroll:true});});
 dialog.addEventListener('click',event=>{if(event.target.closest('[data-go],a'))dismiss();if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dismiss();}});
 addEventListener('km16-view-change',mark);addEventListener('hashchange',()=>{dismiss();mark();});mark();
}
const connection=document.getElementById('app-connectivity');
function connectionState(){if(connection)connection.hidden=navigator.onLine;}
addEventListener('online',connectionState);addEventListener('offline',connectionState);connectionState();
