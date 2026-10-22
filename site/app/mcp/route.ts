import {env} from 'cloudflare:workers';
import {mcpResponse} from '../../lib/datafinder/mcp.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request){return mcpResponse(request,env);}
export async function GET(){return new Response(null,{status:405,headers:{Allow:'POST'}});}
export async function DELETE(){return new Response(null,{status:405,headers:{Allow:'POST'}});}
