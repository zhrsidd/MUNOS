// Country display text → ISO 3166-1 alpha-2 → flag emoji. The stored country text is never rewritten;
// only the flag is derived. Unknown or non-state labels fall back to the globe.
export const UNKNOWN_FLAG='🌐';
// ISO code, then the common name and MUN/common aliases, separated by "|".
const TABLE=`AF:Afghanistan|Islamic Republic of Afghanistan
AL:Albania
DZ:Algeria
AD:Andorra
AO:Angola
AG:Antigua and Barbuda
AR:Argentina
AM:Armenia
AU:Australia
AT:Austria
AZ:Azerbaijan
BS:Bahamas|The Bahamas
BH:Bahrain|Kingdom of Bahrain
BD:Bangladesh
BB:Barbados
BY:Belarus
BE:Belgium
BZ:Belize
BJ:Benin
BT:Bhutan
BO:Bolivia|Plurinational State of Bolivia
BA:Bosnia and Herzegovina|Bosnia
BW:Botswana
BR:Brazil|Federative Republic of Brazil
BN:Brunei|Brunei Darussalam
BG:Bulgaria
BF:Burkina Faso
BI:Burundi
CV:Cabo Verde|Cape Verde
KH:Cambodia
CM:Cameroon
CA:Canada
CF:Central African Republic|CAR
TD:Chad
CL:Chile
CN:China|People's Republic of China|PRC
CO:Colombia
KM:Comoros
CG:Congo|Republic of the Congo|Congo-Brazzaville
CD:Democratic Republic of the Congo|DR Congo|DRC|Congo-Kinshasa
CR:Costa Rica
CI:Côte d'Ivoire|Cote d'Ivoire|Ivory Coast
HR:Croatia
CU:Cuba
CY:Cyprus
CZ:Czechia|Czech Republic
DK:Denmark
DJ:Djibouti
DM:Dominica
DO:Dominican Republic
EC:Ecuador
EG:Egypt|Arab Republic of Egypt
SV:El Salvador
GQ:Equatorial Guinea
ER:Eritrea
EE:Estonia
SZ:Eswatini|Swaziland
ET:Ethiopia
FJ:Fiji
FI:Finland
FR:France|French Republic
GA:Gabon
GM:Gambia|The Gambia
GE:Georgia
DE:Germany|Federal Republic of Germany
GH:Ghana
GR:Greece|Hellenic Republic
GD:Grenada
GT:Guatemala
GN:Guinea
GW:Guinea-Bissau
GY:Guyana
HT:Haiti
VA:Holy See|Vatican City|Vatican|Vatican City State
HN:Honduras
HU:Hungary
IS:Iceland
IN:India|Republic of India
ID:Indonesia
IR:Iran|Islamic Republic of Iran
IQ:Iraq
IE:Ireland
IL:Israel
IT:Italy
JM:Jamaica
JP:Japan
JO:Jordan|Hashemite Kingdom of Jordan
KZ:Kazakhstan
KE:Kenya
KI:Kiribati
KW:Kuwait|State of Kuwait
KG:Kyrgyzstan
LA:Laos|Lao PDR|Lao People's Democratic Republic
LV:Latvia
LB:Lebanon
LS:Lesotho
LR:Liberia
LY:Libya
LI:Liechtenstein
LT:Lithuania
LU:Luxembourg
MG:Madagascar
MW:Malawi
MY:Malaysia
MV:Maldives
ML:Mali
MT:Malta
MH:Marshall Islands
MR:Mauritania
MU:Mauritius
MX:Mexico|United Mexican States
FM:Micronesia|Federated States of Micronesia
MD:Moldova|Republic of Moldova
MC:Monaco
MN:Mongolia
ME:Montenegro
MA:Morocco
MZ:Mozambique
MM:Myanmar|Burma
NA:Namibia
NR:Nauru
NP:Nepal
NL:Netherlands|The Netherlands|Kingdom of the Netherlands|Holland
NZ:New Zealand
NI:Nicaragua
NE:Niger
NG:Nigeria
KP:North Korea|DPRK|Democratic People's Republic of Korea
MK:North Macedonia|Macedonia
NO:Norway
OM:Oman|Sultanate of Oman
PK:Pakistan
PW:Palau
PS:Palestine|State of Palestine|Palestinian Territories
PA:Panama
PG:Papua New Guinea
PY:Paraguay
PE:Peru
PH:Philippines|The Philippines
PL:Poland
PT:Portugal
QA:Qatar|State of Qatar
KR:South Korea|Republic of Korea|ROK
RO:Romania
RU:Russia|Russian Federation
RW:Rwanda
KN:Saint Kitts and Nevis|St Kitts and Nevis
LC:Saint Lucia|St Lucia
VC:Saint Vincent and the Grenadines|St Vincent and the Grenadines
WS:Samoa
SM:San Marino
ST:Sao Tome and Principe|São Tomé and Príncipe
SA:Saudi Arabia|Kingdom of Saudi Arabia|KSA
SN:Senegal
RS:Serbia
SC:Seychelles
SL:Sierra Leone
SG:Singapore
SK:Slovakia|Slovak Republic
SI:Slovenia
SB:Solomon Islands
SO:Somalia
ZA:South Africa|Republic of South Africa
SS:South Sudan
ES:Spain|Kingdom of Spain
LK:Sri Lanka
SD:Sudan
SR:Suriname
SE:Sweden
CH:Switzerland|Swiss Confederation
SY:Syria|Syrian Arab Republic
TJ:Tajikistan
TZ:Tanzania|United Republic of Tanzania
TH:Thailand
TL:Timor-Leste|East Timor
TG:Togo
TO:Tonga
TT:Trinidad and Tobago
TN:Tunisia
TR:Türkiye|Turkiye|Turkey|Republic of Türkiye
TM:Turkmenistan
TV:Tuvalu
UG:Uganda
UA:Ukraine
AE:United Arab Emirates|UAE
GB:United Kingdom|UK|Great Britain|Britain|United Kingdom of Great Britain and Northern Ireland
US:United States|USA|US|United States of America
UY:Uruguay
UZ:Uzbekistan
VU:Vanuatu
VE:Venezuela|Bolivarian Republic of Venezuela
VN:Vietnam|Viet Nam
YE:Yemen
ZM:Zambia
ZW:Zimbabwe
TW:Taiwan
XK:Kosovo
HK:Hong Kong
EU:European Union|EU`;
/** Case, accent, punctuation and leading-article insensitive key. */
export function countryKey(name:string){
 return name.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’'`.]/g,'').replace(/&/g,' and ').replace(/\bsaint\b/g,'st').replace(/[^a-z0-9]+/g,' ').trim().replace(/^the /,'');
}
const INDEX=new Map<string,string>();
for(const line of TABLE.split('\n')){const [code,names]=line.split(':');for(const n of names.split('|'))INDEX.set(countryKey(n),code);}
/** ISO 3166-1 alpha-2 code for a country name or alias, or null when unknown. */
export function countryCode(name:string):string|null{return INDEX.get(countryKey(name))??null;}
export function flagFromCode(code:string):string{return /^[A-Z]{2}$/.test(code)?String.fromCodePoint(...[...code].map(c=>0x1f1e6+c.charCodeAt(0)-65)):UNKNOWN_FLAG;}
/** Flag emoji for a delegation's country; 🌐 for unknown or non-state labels. */
export function countryFlag(name:string):string{const code=countryCode(name);return code?flagFromCode(code):UNKNOWN_FLAG;}
