// testFetch.js

const response = await fetch("https://public.zrd.sh/crux/approved-securities.json");

console.log(response.status);

const data = await response.json();

console.log(data.length);
console.log(data[0]);