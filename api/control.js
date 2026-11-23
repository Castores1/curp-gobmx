export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const URL = `https://raw.githubusercontent.com/Castores1/curp-gobmx/main/control.json`;
    const r = await fetch(URL + '?t=' + Date.now());
    const data = await r.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(200).json({mantenimiento:false, actualizacion:0, ultima_act:"", error:String(e)});
  }
}
