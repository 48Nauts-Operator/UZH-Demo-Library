// Common destinations for the first release. Codes are IATA airport codes.
// City groups deliberately include their named airports, not distant substitutes.
const rows = [
  ['ZRH','Zürich','Zurich,Zurich Airport,Kloten'],['BSL','Basel','EuroAirport,Basel Mulhouse'],['GVA','Genf','Geneva,Genève,Geneve'],
  ['FRA','Frankfurt','Frankfurt am Main'],['MUC','München','Munich,Muenchen'],['BER','Berlin',''],['HAM','Hamburg',''],['DUS','Düsseldorf','Dusseldorf,Duesseldorf'],['STR','Stuttgart',''],['CGN','Köln','Cologne,Koeln'],
  ['VIE','Wien','Vienna'],['SZG','Salzburg',''],['INN','Innsbruck',''],
  ['LHR,LGW,LCY,STN,LTN','London',''],['LHR','London Heathrow','Heathrow'],['LGW','London Gatwick','Gatwick'],['LCY','London City',''],['STN','London Stansted','Stansted'],['LTN','London Luton','Luton'],['MAN','Manchester',''],['EDI','Edinburgh',''],['DUB','Dublin',''],['GLA','Glasgow',''],
  ['CDG,ORY','Paris',''],['CDG','Paris Charles de Gaulle','Charles de Gaulle'],['ORY','Paris Orly','Orly'],['NCE','Nizza','Nice'],['LYS','Lyon',''],['MRS','Marseille',''],['BOD','Bordeaux',''],['TLS','Toulouse',''],
  ['AMS','Amsterdam',''],['BRU','Brüssel','Brussels,Brussel'],['LUX','Luxemburg','Luxembourg'],
  ['FCO','Rom','Rome,Roma'],['MXP,LIN','Mailand','Milan,Milano'],['MXP','Mailand Malpensa','Malpensa'],['LIN','Mailand Linate','Linate'],['VCE','Venedig','Venice,Venezia'],['NAP','Neapel','Naples,Napoli'],['FLR','Florenz','Florence,Firenze'],['BLQ','Bologna',''],['CTA','Catania',''],['PMO','Palermo',''],['OLB','Olbia',''],['CAG','Cagliari',''],
  ['MAD','Madrid',''],['BCN','Barcelona',''],['PMI','Mallorca','Palma,Palma de Mallorca'],['AGP','Málaga','Malaga'],['ALC','Alicante',''],['VLC','Valencia',''],['IBZ','Ibiza',''],['SVQ','Sevilla','Seville'],['TFS','Teneriffa Süd','Tenerife,Teneriffa'],['LPA','Gran Canaria','Las Palmas'],
  ['LIS','Lissabon','Lisbon,Lisboa'],['OPO','Porto',''],['FAO','Faro',''],['FNC','Madeira','Funchal'],
  ['CPH','Kopenhagen','Copenhagen'],['ARN','Stockholm',''],['OSL','Oslo',''],['HEL','Helsinki',''],['KEF','Reykjavik','Reykjavík,Keflavik'],['BGO','Bergen',''],
  ['PRG','Prag','Prague,Praha'],['BUD','Budapest',''],['WAW','Warschau','Warsaw'],['KRK','Krakau','Krakow'],['RIX','Riga',''],['TLL','Tallinn',''],['VNO','Vilnius',''],
  ['ATH','Athen','Athens'],['SKG','Thessaloniki',''],['HER','Heraklion','Kreta,Crete'],['CHQ','Chania',''],['RHO','Rhodos','Rhodes'],['CFU','Korfu','Corfu'],['JTR','Santorini',''],['LCA','Larnaka','Larnaca'],['MLA','Malta',''],
  ['ZAG','Zagreb',''],['SPU','Split',''],['DBV','Dubrovnik',''],['BEG','Belgrad','Belgrade'],['SOF','Sofia',''],['OTP','Bukarest','Bucharest'],['TIA','Tirana',''],['PRN','Pristina',''],['SKP','Skopje',''],
  ['IST,SAW','Istanbul',''],['IST','Istanbul Airport',''],['SAW','Istanbul Sabiha Gökçen','Sabiha Gokcen'],['AYT','Antalya',''],['ADB','Izmir',''],['DLM','Dalaman',''],
  ['DXB','Dubai',''],['AUH','Abu Dhabi',''],['DOH','Doha',''],['CAI','Kairo','Cairo'],['HRG','Hurghada',''],['RAK','Marrakesch','Marrakech,Marrakesh'],['CMN','Casablanca',''],['TUN','Tunis',''],
  ['JFK,EWR','New York','NYC,New York City'],['JFK','New York JFK','JFK Airport'],['EWR','Newark',''],['BOS','Boston',''],['ORD','Chicago',''],['MIA','Miami',''],['LAX','Los Angeles',''],['SFO','San Francisco',''],['LAS','Las Vegas',''],['IAD','Washington','Washington DC'],['YYZ','Toronto',''],['YUL','Montreal','Montréal'],['YVR','Vancouver',''],
  ['BKK','Bangkok',''],['SIN','Singapur','Singapore'],['HKG','Hongkong','Hong Kong'],['NRT,HND','Tokio','Tokyo'],['HND','Tokio Haneda','Haneda'],['NRT','Tokio Narita','Narita'],['ICN','Seoul',''],['DPS','Bali','Denpasar'],['HKT','Phuket',''],['KUL','Kuala Lumpur',''],['DEL','Delhi','New Delhi'],['BOM','Mumbai','Bombay'],['MLE','Malediven','Maldives,Male,Malé'],['CMB','Colombo',''],
  ['SYD','Sydney',''],['MEL','Melbourne',''],['AKL','Auckland',''],['CPT','Kapstadt','Cape Town'],['JNB','Johannesburg',''],['NBO','Nairobi',''],['GRU','São Paulo','Sao Paulo'],['GIG','Rio de Janeiro','Rio'],['EZE','Buenos Aires',''],['CUN','Cancún','Cancun'],['MEX','Mexico City','Mexiko-Stadt']
];
export const airports = rows.map(([id,name,aliases])=>({id,name,aliases:aliases.split(',').filter(Boolean)}));
export const airportMap = new Map(airports.map(a=>[a.id,a]));
export const originChoices = [...airports, {id:'ZRH,BSL',name:'Zürich oder Basel',aliases:[]}, {id:'ZRH,BSL,GVA',name:'Schweiz: Zürich, Basel oder Genf',aliases:[]}];
export function airportName(id){return airportMap.get(id)?.name || originChoices.find(a=>a.id===id)?.name || id;}
