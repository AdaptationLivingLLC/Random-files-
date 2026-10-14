import { handleRequest } from '../runtime.mjs';
export default async function handler(req,res) {
 const url = new URL(req.url,'http://localhost');
 const route = url.searchParams.get('route');
 if (route) req.url = '/api/' + route;
 await handleRequest(req,res);
}
