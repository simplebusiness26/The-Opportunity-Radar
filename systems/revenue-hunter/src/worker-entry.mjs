import worker from './worker.mjs';
import { RevenueRepository } from './repository.mjs';
import { customerDemoHtml } from './customer-demo.mjs';

const html=(body,status=200)=>new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    const match=url.pathname.match(/^\/demo\/([^/]+)$/);
    if(match&&request.method==='GET'){
      const repo=new RevenueRepository(env.REVENUE_DB);
      const prospect=await repo.get(match[1]);
      return prospect?html(customerDemoHtml(prospect)):html('Not found',404);
    }
    return worker.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx){
    if(typeof worker.scheduled==='function')return worker.scheduled(controller,env,ctx);
  }
};
