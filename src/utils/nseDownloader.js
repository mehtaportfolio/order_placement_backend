import axios from "axios";

export async function downloadCsv(url, referer) {
  const response = await axios.get(url, {
    responseType: "text",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": referer,
      "Accept": "text/csv,*/*"
    }
  });

  return response.data;
}