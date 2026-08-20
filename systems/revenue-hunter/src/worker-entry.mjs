import worker from './worker.mjs';
import { RevenueRepository } from './repository.mjs';
import { customerDemoHtml } from './customer-demo.mjs';
import { addManualWebsite } from './manual-intake.mjs';

const html=(body,status=200)=>new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
const json=(body,status=200)=>new Response(JSON.stringify(body,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const readJson=async request=>request.json().catch(()=>({}));
const feedbackText=b=>{
  const parts=[b.layout&&`Layout: ${b.layout}`,b.hero&&`Hero: ${b.hero}`,b.palette&&`Colours: ${b.palette}`,Number.isFinite(Number(b.image))&&`Hero image: ${Number(b.image)+1}`,b.cta&&`CTA: ${b.cta}`,b.note&&`Note: ${String(b.note).slice(0,500)}`].filter(Boolean);
  return `Customer demo preferences — ${parts.join(' • ')}`;
};

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    const repo=new RevenueRepository(env.REVENUE_DB);

    const demo=url.pathname.match(/^\/demo\/([^/]+)$/);
    if(demo&&request.method==='GET'){
      const prospect=await repo.get(demo[1]);
      return prospect?html(customerDemoHtml(prospect)):html('Not found',404);
    }

    const feedback=url.pathname.match(/^\/api\/demo-feedback\/([^/]+)$/);
    if(feedback&&request.method==='POST'){
      const prospect=await repo.get(feedback[1]);
      if(!prospect)return json({error:'prospect not found'},404);
      const body=await readJson(request);
      const note=feedbackText(body);
      await repo.addNote(prospect.id,note);
      await repo.updateSales(prospect.id,{stage:'interested',nextAction:'Review customer demo preferences',note});
      return json({ok:true,message:'Preferences saved'});
    }

    if(url.pathname==='/api/manual-site'&&request.method==='POST'){
      const body=await readJson(request);
      if(!body.website&&!body.url)return json({error:'website URL required'},400);
      try{
        const prospect=await addManualWebsite({repo,env,input:body});
        return json({ok:true,prospect,demo:`/demo/${prospect.id}`,dossier:`/dossier/${prospect.id}`},201);
      }catch(error){
        return json({error:error instanceof Error?error.message:String(error)},400);
      }
    }

    return worker.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx){
    if(typeof worker.scheduled==='function')return worker.scheduled(controller,env,ctx);
  }
};