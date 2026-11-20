import { createShirtPaymentHandler } from './handler.mjs';

Deno.serve(createShirtPaymentHandler({
  env: (name: string) => Deno.env.get(name),
  fetcher: fetch,
}));
