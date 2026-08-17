// Classifies Norwegian offer text into shopping categories.
//
// Rules are evaluated in order and the first hit wins, so narrow categories
// (baby, pet, personal care) must sit above broad ones (dairy, meat) — otherwise
// "barnegrøt" lands in Tørrvarer and "hundemat" in Kjøtt.
//
// Matching runs against the offer heading plus its description, so brand-only
// headings like "Yoplait" still classify from the description text.

const RULES = [
  ['Barn & baby', /\b(baby|barnegr(ø|oe)t|barnemat|sm(å|aa)barn|velling|graut|morsmelk|bleie(r|ne)?|pampers|libero|v(å|aa)tservietter|nestl(e|é)|hipp\b|ella'?s|semper|smoothiebiter|barnekjeks|t(å|aa)teflaske|smokk)\b/i],
  ['Dyr', /\b(hundemat|kattemat|hundefor|kattefor|kattesand|hundegodt|tyggeben|whiskas|pedigree|royal ?canin|pussi|felix\b|purina|dyrebutikk|akvarie|fuglefr(ø|oe)|hamster|kanin(bur)?)\b/i],
  ['Apotek & helse', /\b(paracet|ibux|vitamin|omega ?3|tran\b|kosttilskudd|probiotika|plaster|apotek|reseptfri|hostesaft|halstablett|nesespray|allergi|plaster|plasterr?|proteinpulver|elektrolytt)\b/i],
  ['Personlig pleie', /\b(shampo(o)?|balsam|h(å|aa)rfarge|dusjs(å|aa)pe|dusjgel(e|é)|s(å|aa)pe|deodorant|antiperspirant|tannkrem|tannb(ø|oe)rste|tanntr(å|aa)d|munnskyll|bind\b|tampong|truseinnlegg|barberh(ø|oe)vel|barberskum|hudkrem|bodylotion|solkrem|after ?sun|nivea|colgate|gillette|always|libresse|q-?tips|parfyme|eau de|sminke|mascara|leppestift|neglelakk|v(å|aa)tserviett)\b/i],
  ['Husholdning', /\b(vaskemiddel|t(ø|oe)yvask|skyllemiddel|oppvask|maskinoppvask|zalo|omo\b|milo\b|blenda|ariel|jif\b|klorin|ajax|rengj(ø|oe)ring|allrent|t(ø|oe)rkerull|husholdningspapir|toalettpapir|dopapir|servietter|s(ø|oe)ppelsekk|s(ø|oe)ppelpose|fryseposer|plastposer|aluminiumsfolie|matpapir|bakepapir|stearinlys|telys|batteri(er)?|lyspære|gl(ø|oe)delampe|vaskeklut|kluter|sv(a|æ)mp|luftfrisker)\b/i],
  ['Snacks & godteri', /\b(chips|potetgull|maarud|sørlandschips|s(ø|oe)rlandschips|kims\b|nachos|tortillachips|ostepop|cheez|snacks|saltstenger|peanøtter|peanoetter|n(ø|oe)tter|cashew|mandler|godteri|sm(å|aa)godt|sjokolade|melkesjokolade|kvikk ?lunsj|stratos|firkl(ø|oe)ver|daim|snickers|mars\b|twix|bounty|toblerone|marabou|freia|nidar|smash\b|non ?stop|smarties|seigmenn|lakris|drops|pastill|tyggis|extra ?tyggegummi|popcorn|kjeks|oreo|bixit|ballerina|gullbr(ø|oe)d|digestive|marie ?kjeks|sjokoladeplate)\b/i],
  ['Is & dessert', /\b(iskrem|is\b|sm(å|aa)is|pinneis|b(å|aa)tis|krokanis|diplom-?is|hennig-?olsen|royal ?is|ben ?& ?jerry|magnum|dessert|pudding|panna ?cotta|riskrem|karamellpudding|gel(e|é)|fromasj|sjokolademousse)\b/i],
  ['Kaffe & te', /\b(kaffe|filterkaffe|kaffekapsler|kaffebønner|kaffeb(ø|oe)nner|friele|evergood|ali\b|nespresso|dolce ?gusto|espresso|instant ?kaffe|nescaf(e|é)|\bte\b|tebrev|urtete|lipton|twinings|pickwick|kakao|o'?boy|nesquik|sjokoladedrikk)\b/i],
  ['Drikke', /\b(cola|coca-?cola|pepsi|fanta|sprite|solo\b|urge\b|brus|mineralvann|farris|imsdal|bonaqua|vann ?flaske|juice|jus\b|tropicana|sunniva|appelsinjuice|eplejuice|saft\b|nectar|iste|energidrikk|red ?bull|monster|battery|nocco|powerade|gatorade|(ø|oe)l\b|pils|cider|vin\b|rødvin|hvitvin|alkoholfri|smoothie|drikkeyoghurt|sportsdrikk|pant\b)\b/i],
  ['Ost', /\b(ost\b|oster\b|norvegia|jarlsberg|gudbrandsdalsost|fl(ø|oe)temysost|brunost|gulost|hvitost|cheddar|brie|camembert|revet ?ost|smøreost|sm(ø|oe)reost|snøfrisk|sn(ø|oe)frisk|kremost|philadelphia|fetaost|feta\b|apetina|mozzarella|parmesan|pr(e|é)sident|kremgo|port ?salut)\b/i],
  ['Meieri & egg', /\b(melk\b|lettmelk|helmelk|skummet ?melk|ekstra ?lett|yoghurt|yougurt|skyr|kvarg|yoplait|activia|biola|kefir|go'?morgen|kulturmelk|r(ø|oe)mme|cr(e|è)me ?fra(i|î)che|fl(ø|oe)te|matfl(ø|oe)te|kremfl(ø|oe)te|kesam|cottage ?cheese|sm(ø|oe)r\b|margarin|brelett|melange|vita ?ekstra|soft ?flora|egg\b|eggekartong|tine\b|q-?melk|synn(ø|oe)ve)\b/i],
  ['Fisk & sjømat', /\b(laks\b|laksefilet|torsk|sei\b|(ø|oe)rret|makrell|sild\b|reker|krabbe|skalldyr|fiskekake|fiskepudding|fiskeboller|fiskegrateng|fiskepinner|fiskegrateng|fiskemannen|lofoten\b|sj(ø|oe)mat|tunfisk|scampi|bl(å|aa)skjell|kaviar|rakfisk|klippfisk|bacalao|gravlaks|r(ø|oe)ykt ?laks|r(ø|oe)kt ?laks|findus ?fisk|sjømatsalat)\b/i],
  ['Kjøtt & fjørfe', /\b(kj(ø|oe)ttdeig|karbonade|karbonadedeig|biff\b|entrec(o|ô)te|indrefilet|ytrefilet|svinekj(ø|oe)tt|svinekoteletter|koteletter|nakkekoteletter|ribbe|flatbiff|kylling|kyllingfilet|kyllinglår|kyllingl(å|aa)r|kyllingvinger|kalkun|and\b|lammel(å|aa)r|lam\b|f(å|aa)rik(å|aa)l|p(ø|oe)lse|grillp(ø|oe)lse|wienerp(ø|oe)lse|bacon|skinke|medisterkake|kj(ø|oe)ttkake|hamburger|burger|farse|gilde|prior\b|nordfjord|grilstad|finsbr(å|aa)ten|spekemat|salami|kebab|marinert ?kj(ø|oe)tt|grillmat|strimlet)\b/i],
  ['Pålegg', /\b(leverpostei|makrell ?i ?tomat|syltet(ø|oe)y|prim\b|nugatti|nutella|peanøttsm(ø|oe)r|peanoettsm(ø|oe)r|honning|servelat|skinkeost|majones|p(å|aa)legg|stabburet|mills\b|kaviar ?tube|smøreost)\b/i],
  ['Brød & bakeri', /\b(br(ø|oe)d\b|grovbr(ø|oe)d|loff|rundstykker|baguette|knekkebr(ø|oe)d|wasa|lefse|lompe|vaffel|vaffelr(ø|oe)re|pannekake|bolle(r)?|kanelbolle|skolebr(ø|oe)d|croissant|toast|pitabr(ø|oe)d|tortilla|wrap(s)?|bakeri|kake\b|kaker\b|muffins|donut|smultring|matpakkekaker|småplater|sm(å|aa)plater|bygglunsj|ukens ?br(ø|oe)d)\b/i],
  ['Frukt & grønt', /\b(eple(r)?|p(æ|ae)re(r)?|banan(er)?|appelsin|klementin(er)?|mandarin|drue(r)?|jordb(æ|ae)r|bl(å|aa)b(æ|ae)r|bringeb(æ|ae)r|melon|vannmelon|ananas|mango|avokado|tomat(er)?|agurk|salat|isbergsalat|paprika|gulr(ø|oe)tter|gulrot|l(ø|oe)k\b|potet(er)?|nypotet|brokkoli|blomk(å|aa)l|k(å|aa)l\b|spinat|sopp\b|champignon|squash|aubergine|mais\b|erter|sukkererter|b(ø|oe)nner|frukt|gr(ø|oe)nnsak|urter|basilikum|persille|sitron|lime\b|ingef(æ|ae)r|hvitl(ø|oe)k|frukt ?og ?gr(ø|oe)nt|r(ø|oe)sslyng|lyng\b|stemor|plante(r)?)\b/i],
  ['Middag & ferdigmat', /\b(pizza|grandiosa|peppes|big ?one|lasagne|taco|tacokrydder|tortillalefser|enchilada|wok\b|gryte(r)?|suppe(r)?|toro\b|fjordland|ferdigrett|pai\b|pirog|pastasaus|dolmio|middag|grateng|pytt ?i ?panne|risotto|nudler|mr\.? ?lee|nissin|nudelsuppe|pommes ?frites)\b/i],
  ['Frysevarer', /\b(frossen|fryst|dypfryst|frysevare|findus|frionor|isbit|frosne)\b/i],
  ['Tørrvarer & baking', /\b(pasta|spaghetti|makaroni|penne|fusilli|lasagneplater|ris\b|jasminris|basmati|couscous|bulgur|quinoa|linser|kikerter|hermetikk|frokostblanding|m(ü|y)sli|musli|corn ?flakes|havregryn|havregr(ø|oe)t|gr(ø|oe)t\b|sopps|barilla|uncle ?ben|mel\b|hvetemel|sukker|melis|gj(æ|ae)r|bakepulver|kakemiks|vaniljesukker|sirup|kokosmelk|tomatpur(e|é)|hakkede ?tomater)\b/i],
  ['Saus & krydder', /\b(ketchup|sennep|dressing|remulade|bearnaise|saus\b|soyasaus|sriracha|chilisaus|krydder|salt\b|pepper\b|buljong|olje\b|olivenolje|rapsolje|eddik|balsamico|idun\b|tacosaus|salsa|dip\b|hvitl(ø|oe)ksaus)\b/i],
  ['Bygg & jernvare', /\b(maling|beis|lakk\b|pensel|skrue(r)?|spiker|verkt(ø|oe)y|drill|bore|sag\b|hammer|stige|isolasjon|gips|planke|terrassebord|impregnert|sement|betong|fliser|laminat|parkett|takrenne|el-?artikler|arbeidst(ø|oe)y|vernesko|hansker|bygg\b|byggevare)\b/i],
  ['Møbler & interiør', /\b(sofa|l(e|æ)nestol|stol\b|spisebord|bord\b|seng\b|madrass|sengegavl|kommode|skap\b|hylle|reol|teppe\b|gardin|pute(r)?|dyne|sengesett|lampe|taklampe|bordlampe|speil|bilderamme|dekorasjon|interi(ø|oe)r|kj(ø|oe)kkenutstyr|kasserolle|stekepanne|gryte(sett)?|tallerken|glass\b|bestikk|oppbevaring|kurv\b|handlekurv)\b/i],
  ['Elektronikk', /\b(tv\b|fjernsyn|h(ø|oe)yttaler|soundbar|hodetelefon(er)?|(ø|oe)replugger|airpods|mobil(telefon)?|iphone|samsung|laptop|pc\b|nettbrett|ipad|skjerm|monitor|kamera|smartklokke|lader|powerbank|usb|ruter|konsoll|playstation|xbox|nintendo|robotst(ø|oe)vsuger|st(ø|oe)vsuger|kaffemaskin|mikrob(ø|oe)lge|air ?fryer|vaskemaskin|kj(ø|oe)leskap)\b/i],
  ['Sport & fritid', /\b(sykkel|sykkelhjelm|l(ø|oe)pesko|joggesko|treningst(ø|oe)y|tights|sportsutstyr|ski\b|skist(ø|oe)vler|slalom|fotball|h(å|aa)ndball|basketball|golf|fiskestang|telt\b|sovepose|tursekk|ryggsekk|bål|termos|treningsapparat|vekter|manualer|yogamatte|fitness|gym\b|medlemskap)\b/i],
  ['Klær & sko', /\b(jakke|bukse(r)?|genser|t-?skjorte|skjorte|kjole|sokker|undert(ø|oe)y|truse(r)?|bh\b|pyjamas|sko\b|st(ø|oe)vler|sandaler|lue\b|votter|skjerf|regnt(ø|oe)y|kl(æ|ae)r)\b/i],
  ['Hage & uterom', /\b(hagem(ø|oe)bler|grill\b|gassgrill|kullgrill|briketter|grillkull|plantejord|gj(ø|oe)dsel|potte\b|blomsterpotte|hageslange|gressklipper|hekksaks|utebelysning|parasoll|hammock|badebasseng|terrasse)\b/i],
];

export const CATEGORIES = [...new Set(RULES.map(([c]) => c)), 'Annet'];

export function categorize(text) {
  if (!text) return 'Annet';
  for (const [cat, re] of RULES) if (re.test(text)) return cat;
  return 'Annet';
}

// Retail sector per chain, so the UI can separate a grocery deal from a
// building-supplies deal. Chains absent here fall back to 'Annet'.
export const SECTORS = {
  'KIWI': 'Dagligvarer', 'REMA 1000': 'Dagligvarer', 'MENY': 'Dagligvarer',
  'Extra': 'Dagligvarer', 'Coop Extra': 'Dagligvarer', 'Coop Mega': 'Dagligvarer',
  'Coop Prix': 'Dagligvarer', 'Coop Marked': 'Dagligvarer', 'Obs': 'Dagligvarer',
  'SPAR': 'Dagligvarer', 'Joker': 'Dagligvarer', 'Bunnpris': 'Dagligvarer',
  'Matkroken': 'Dagligvarer', 'Nærbutikken': 'Dagligvarer', 'Jacobs': 'Dagligvarer',
  'Holdbart': 'Dagligvarer', 'Gigaboks': 'Dagligvarer', 'CC Mat': 'Dagligvarer',
  'Afood Market': 'Dagligvarer', 'Havaristen': 'Dagligvarer', '24SJU': 'Dagligvarer',
  'Europris': 'Lavpris & variert', 'Rusta': 'Lavpris & variert',
  'Normal': 'Lavpris & variert', 'Nille': 'Lavpris & variert',
  'Spar Kjøp': 'Lavpris & variert', 'Jula': 'Lavpris & variert',
  'Biltema': 'Bygg & jernvare', 'MAXBO': 'Bygg & jernvare', 'Byggmakker': 'Bygg & jernvare',
  'Byggmax': 'Bygg & jernvare', 'Coop Byggmix': 'Bygg & jernvare', 'Obs! Bygg': 'Bygg & jernvare',
  'jem & fix': 'Bygg & jernvare', 'Megaflis': 'Bygg & jernvare', 'Jernia': 'Bygg & jernvare',
  'Byggfag': 'Bygg & jernvare', 'Right Price Tiles': 'Bygg & jernvare',
  'Monter': 'Bygg & jernvare', 'NorBo1': 'Bygg & jernvare',
  'Skeidar': 'Møbler & interiør', 'Bohus': 'Møbler & interiør',
  'Fagmøbler': 'Møbler & interiør', 'Møbelringen': 'Møbler & interiør',
  'JYSK': 'Møbler & interiør', 'Kid': 'Møbler & interiør',
  'POWER': 'Elektronikk', 'Elkjøp': 'Elektronikk', 'Power': 'Elektronikk',
  'XXL': 'Sport & fritid', 'Sport Outlet': 'Sport & fritid', 'Intersport': 'Sport & fritid',
  'Sport 1': 'Sport & fritid', 'EVO Fitness': 'Sport & fritid',
  'Vita': 'Helse & skjønnhet', 'Apotek 1': 'Helse & skjønnhet',
  'Vitusapotek': 'Helse & skjønnhet', 'Life': 'Helse & skjønnhet',
  'Felleskjøpet': 'Hage & dyr', 'Bondekompaniet': 'Hage & dyr', 'PetXL': 'Hage & dyr',
};

// "Gartner brokkolini 200g" -> "Gartner". Only trusted when the leading token is
// capitalised and is not a generic descriptor, so "Norske nypoteter" yields null.
const GENERIC_FIRST = /^(norske?|fersk|ferske|frossen|frosne|(ø|oe)kologisk|utvalgte|diverse|flere|store|sm(å|aa)|hele|nye|ekstra|super|mega|billig|nyhet|ukens|alle|div)$/i;

export function extractBrand(text) {
  const first = String(text ?? '').trim().split(/[\s,/]+/)[0] ?? '';
  if (first.length < 2 || GENERIC_FIRST.test(first)) return null;
  if (!/^[A-ZÆØÅ]/.test(first)) return null;
  const clean = first.replace(/[^\wÆØÅæøå'&.-]/g, '');
  // All-caps headings ("LAKSEFILET") are product names, not brands.
  if (clean === clean.toUpperCase() && clean.length > 4) return null;
  return clean || null;
}
