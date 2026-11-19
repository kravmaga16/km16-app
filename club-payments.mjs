export const clubPaymentLabel = method => method === 'cheque' ? 'Chèque' : 'Espèces';

export function withClubPayments(clients, payments) {
 const result = [...clients];
 const indexes = new Map(clients.map((client, index) => [client.id, index]));
 for (const payment of payments) {
  const id = payment.client_id || 'club:' + payment.id;
  let index = indexes.get(id);
  if (index === undefined) {
   index = result.length;
   indexes.set(id, index);
   result.push({
    id, group:'À vérifier', first_name:payment.first_name, last_name:payment.last_name,
    email:payment.email || '', address:[], products:[], amounts:{}, source:'Règlement au club'
   });
  }
  const client = result[index];
  const amounts = {...client.amounts};
  for (const key of ['gross_cents','net_cents','planned_cents']) {
   amounts[key] = (amounts[key] || 0) + payment.amount_cents;
  }
  const product = {
   title:'Règlement au club · ' + clubPaymentLabel(payment.method) + ' · ' + payment.received_on,
   state:'Encaissé', total_cents:payment.amount_cents, net_cents:payment.amount_cents
  };
  result[index] = {...client, amounts, products:[...client.products, product], club_payments:true};
 }
 return result;
}

export function clubAmountKnown(client, key) {
 return !client.external_only || (client.club_payments && ['gross_cents','net_cents','planned_cents'].includes(key));
}
