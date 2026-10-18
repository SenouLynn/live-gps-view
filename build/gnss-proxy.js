/** Fixed public GNSS catalog; shared cache prevents a sky-plot redraw from querying the provider. */
export function gnssProxy(){
  let cached, pending, retryAt=0;
  const install=server=>{
    server.middlewares.use('/api/gnss-orbits',async(req,res)=>{
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      try{
        if(!cached||Date.now()-cached.at>2*3600000){
          if(Date.now()<retryAt)throw new Error('Catalog cooldown');
          if(!pending)pending=(async()=>{
            try{
              const r=await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json',{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'live-gps-view/0.1 (GNSS sky plot)'}});
              if(!r.ok)throw new Error('Catalog unavailable');
              const rows=await r.json();if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw new Error('Invalid catalog');
              cached={at:Date.now(),rows};
            }catch(e){retryAt=Date.now()+15*60000;throw e;}finally{pending=undefined;}
          })();
          await pending;
        }
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify({fetchedAt:cached.at,source:'CelesTrak GNSS GP catalog',elements:cached.rows}));
      }catch{res.writeHead(503,{'Content-Type':'application/json','Retry-After':'900'});res.end(JSON.stringify({error:'GNSS catalog unavailable; retry later'}));}
    });
  };
  return{name:'gnss-orbits',configureServer:install,configurePreviewServer:install};
}
