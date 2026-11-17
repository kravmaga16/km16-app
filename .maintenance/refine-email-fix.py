from pathlib import Path
p=Path('adhesion.mjs');s=p.read_text()
changes={
 'let accountRevision=0,accountLoginBusy=false;':'let accountRevision=0,accountLoginBusy=false,catalogueReady=false;',
 'return;}await orders();if(isAdmin&&!embedded&&!accountView)':'return;}if(!catalogueReady)return;await orders();if(isAdmin&&!embedded&&!accountView)',
 ' // Authentication is initialized independently, before catalogue loading.':" catalogueReady=true;if(session)void authState(session).catch(()=>accountMessage('Les informations du compte sont temporairement indisponibles.',true));"
}
for old,new in changes.items():
 if s.count(old)!=1:raise SystemExit('Unexpected source: '+old)
 s=s.replace(old,new)
p.write_text(s)
print('Preserved catalogue-dependent administrator setup while restoring account UI early.')
