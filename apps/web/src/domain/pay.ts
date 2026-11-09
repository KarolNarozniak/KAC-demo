export const formatPln=(amount:number)=>new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'}).format(amount);
