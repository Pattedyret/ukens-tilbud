// Classifies Norwegian offer text into shopping categories.
//
// TWO THINGS MAKE THIS DIFFERENT FROM AN ENGLISH KEYWORD CLASSIFIER
//
// 1. `\b` is unusable. JavaScript's \w is [A-Za-z0-9_], so æ, ø and å count as
//    NON-word characters and \b fires *inside* ordinary Norwegian words:
//        /\bte\b/i.test('søte')  ===  true
//    That single quirk classified clementines as tea. Every whole-word rule
//    here goes through word() below, which uses explicit lookarounds over a
//    character class that includes æøå.
//
// 2. Norwegian builds closed compounds, so the head noun sits at the END of a
//    word: VEGGLAMPE, GULVLAMPE, SPISESTOL, NATTBORD. Whole-word matching finds
//    none of them. Rules that need to match inside compounds use stem().
//
// Rules are ordered and first match wins, so narrow categories (baby, pet,
// health) sit above broad ones (dairy, meat). Anything unmatched stays 'Annet'
// rather than being forced into a category it does not belong to.

const WORD_CHAR = 'a-zA-ZæøåÆØÅ0-9';

/** Whole-word match, Norwegian-aware. word('te') matches "te", not "søte". */
const word = pattern => new RegExp(`(?<![${WORD_CHAR}])(?:${pattern})(?![${WORD_CHAR}])`, 'i');

/** Substring match, for stems that appear inside compounds (VEGG·LAMPE). */
const stem = pattern => new RegExp(`(?:${pattern})`, 'i');

const RULES = [
  // --- narrow categories first: these words also appear in broader ones ---
  ['Barn & baby', word('baby\\w*|barnemat|barnegr(ø|oe)t|sm(å|aa)barn\\w*|velling|morsmelk\\w*|bleier?|pampers|libero|t(å|aa)teflaske|smokk|barnekjeks|smoothiebiter|nestl(e|é)|hipp|semper')],
  ['Dyr', stem('hundemat|kattemat|hundefor|kattefor|kattesand|hundegodt|tyggeben|kattetre|hundeb(å|aa)nd|dyrefor|fuglefr(ø|oe)|akvarie')],
  ['Dyr', word('whiskas|pedigree|royal ?canin|pussi|purina|felix')],
  ['Apotek & helse', stem('kosttilskudd|proteinpulver|vitamintilskudd|hostesaft|halstablett|nesespray|reseptfri')],
  ['Apotek & helse', word('paracet\\w*|ibux|apotek|plaster|probiotika|elektrolytter?')],

  // --- personal care and household: distinctive, low collision risk ---
  ['Personlig pleie', stem('shampo|balsam|h(å|aa)rfarge|dusjs(å|aa)pe|dusjgel|h(å|aa)nds(å|aa)pe|deodorant|antiperspirant|tannkrem|tannb(ø|oe)rste|tanntr(å|aa)d|munnskyll|truseinnlegg|barberh(ø|oe)vel|barberskum|barberblad|hudkrem|bodylotion|solkrem|fuktighetskrem|ansiktsmaske|leppestift|neglelakk|mascara|sminke|parfyme|v(å|aa)tservietter')],
  ['Personlig pleie', word('nivea|colgate|gillette|always|libresse|q-?tips|bind|tamponger?|dove|axe|old spice')],
  ['Husholdning', stem('vaskemiddel|t(ø|oe)yvask|skyllemiddel|oppvask(?!maskin)|maskinoppvask|rengj(ø|oe)ring|allrent|t(ø|oe)rkerull|husholdningspapir|toalettpapir|dopapir|s(ø|oe)ppelsekk|s(ø|oe)ppelpose|fryseposer|plastposer|aluminiumsfolie|matpapir|bakepapir|stearinlys|telys|lyspære|gl(ø|oe)delampe|vaskeklut|luftfrisker|gulvmopp|st(ø|oe)vklut')],
  ['Husholdning', word('zalo|omo|milo|blenda|ariel|jif|klorin|ajax|serviett(er)?|kluter|sv(a|æ)mper?|batterier?')],

  // --- lighting before furniture: a GULVLAMPE is not a GULVTEPPE ---
  ['Belysning', stem('lampe|lampett|lysekrone|pendel|spotplate|spotrekke|enkelspot|lyslenke|lysslynge|utebelysning|taklys|leselys')],
  ['Belysning', word('spot|spotter|pendler|lyspunkt')],

  // --- furniture and interior: head noun sits at the end of the compound ---
  ['Møbler & interiør', stem('sofa|l(e|æ)nestol|spisestol|kontorstol|barstol|gyngestol|nattbord|sidebord|sofabord|spisebord|skrivebord|konsollbord|salongbord|trekrakk|krakk|vegghylle|bokhylle|garderobe|kommode|skjenk|vitrine|sengegavl|overmadrass|madrass|sengesett|senget(ø|oe)y|dyne\\w*|putetrekk|hodepute|hotellpute|gulvteppe|d(ø|oe)rmatte|gardin\\w*|persienne|speil|bilderamme|lysestake|vase|skittent(ø|oe)yskurv|oppbevaringskurv|puff|benk|reol|stativ|knagg')],
  ['Møbler & interiør', stem('kontinentalseng|rammeseng|seng(eramme|epakke)|hvilestol|recliner|sovesofa|hj(ø|oe)rnesofa|spisegruppe|salongsett|skohylle|skjenkeskap|tv-?benk')],
  ['Møbler & interiør', word('seng|senger|stol|stoler|bord|teppe|tepper|pute|puter|skap|hylle|hyller|kurv|diffuser|duft(lys|pinner)?|seter|seteputer')],
  ['Kjøkken & servering', stem('kasserolle|stekepanne|grytesett|kjelesett|tallerken|bestikk|kj(ø|oe)kkenredskap|skj(æ|ae)refjel|kniv(sett|blokk)|vinglass|drikkeglass|kaffekopp|krus|serveringsfat|bolle(sett)?|form(sett)?|termos|matboks|drikkeflaske')],

  // --- food: brands and product nouns ---
  // -ost compounds are enumerated rather than matched by a generic "ost" tail:
  // any lookbehind cheap enough to write still let "EPLEMOST" and "frost"
  // through, and a juice filed under cheese is worse than one left in 'Annet'.
  ['Ost', stem('salatost|pizzaost|revetost|revet ?ost|sm(ø|oe)reost|kremost|fl(ø|oe)teost|fetaost|gulost|hvitost|brunost|geitost|pult(o)?st|ostepop|ostesaus|ostest(a|æ)nger|ostehøvel')],
  ['Ost', word('ost|oster|norvegia|jarlsberg|gudbrandsdalsost|fl(ø|oe)temysost|cheddar|brie|camembert|feta|apetina|mozzarella|parmesan|pr(e|é)sident|snøfrisk|sn(ø|oe)frisk|philadelphia|port ?salut|kremgo')],
  ['Meieri & egg', stem('lettmelk|helmelk|skummetmelk|melkedrikk|drikkeyoghurt|yoghurt|matfl(ø|oe)te|kremfl(ø|oe)te|kaffefl(ø|oe)te|r(ø|oe)mmedressing|kulturmelk|cottage')],
  ['Meieri & egg', word('melk|yoghurt|skyr|kvarg|yoplait|activia|biola|kefir|go.?morgen|r(ø|oe)mme|cr(e|è)me ?fra(i|î)che|fl(ø|oe)te|kesam|sm(ø|oe)r|margarin|brelett|melange|egg|tine|q-?melk|synn(ø|oe)ve')],
  ['Fisk & sjømat', stem('laksefilet|fiskekake|fiskepudding|fiskeboller|fiskegrateng|fiskepinner|fiskesuppe|sj(ø|oe)mat|tunfisk|bl(å|aa)skjell|klippfisk|gravlaks|r(ø|oe)ykelaks|sildesalat|rekesalat|krabbeklør|sprøbakt hyse|spr(ø|oe)bakt')],
  ['Fisk & sjømat', word('laks|torsk|sei|(ø|oe)rret|makrell|sild|reker|krabbe|skalldyr|hyse|uer|kveite|scampi|kaviar|rakfisk|bacalao|fiskemannen|lofoten|frionor')],
  ['Kjøtt & fjørfe', stem('kj(ø|oe)ttdeig|karbonadedeig|kyllingfilet|kyllingl(å|aa)r|kyllingvinger|kyllingkj(ø|oe)ttdeig|kyllingbryst|svinekj(ø|oe)tt|svinekoteletter|nakkekoteletter|medisterkake|kj(ø|oe)ttkake|kj(ø|oe)ttp(ø|oe)lse|grillp(ø|oe)lse|wienerp(ø|oe)lse|p(ø|oe)lser?|spekemat|spekeskinke|lammel(å|aa)r|f(å|aa)rik(å|aa)l|kalkunp(å|aa)legg|kyllingp(å|aa)legg')],
  ['Kjøtt & fjørfe', word('kylling|kalkun|biff|entrec(o|ô)te|indrefilet|ytrefilet|koteletter|ribbe|bacon|skinke|hamburger|burger|karbonade|farse|gilde|prior|nordfjord|grilstad|finsbr(å|aa)ten|salami|kebab|lam|svin|storfe')],
  ['Pålegg', stem('leverpostei|syltet(ø|oe)y|peanøttsm(ø|oe)r|peanoettsm(ø|oe)r|skinkeost|kaviartube|makrell i tomat|peanut butter')],
  ['Pålegg', word('prim|nugatti|nutella|honning|servelat|majones|p(å|aa)legg|stabburet|mills')],
  ['Brød & bakeri', stem('grovbr(ø|oe)d|rundstykker|knekkebr(ø|oe)d|bondebr(ø|oe)d|loff|baguette|pitabr(ø|oe)d|tortilla|lomper?|lefse|vaffel|pannekake|kanelbolle|skolebr(ø|oe)d|croissant|smultring|matpakkekake|sm(å|aa)plater|bygglunsj|br(ø|oe)dmiks|bakverk|nystekt')],
  // Compound tails: RUNDBRØD, havrebakst, maiskake all end in the head noun.
  ['Brød & bakeri', stem('br(ø|oe)d(et|er)?(?![a-zæøå])|bakst|kaker?(?![a-zæøå])|boller?(?![a-zæøå])')],
  ['Brød & bakeri', word('naan|pitabrød|wasa|bakehuset|s(æ|ae)tre|bakers|muffins|donut|toast|regal')],
  // Breakfast cereal outranks fruit: "Axa müsli frukt" is a dry good, not produce.
  ['Tørrvarer & baking', stem('m(ü|y)sli|musli|frokostblanding|frokostkorn|granola|byggryn|byggmel|byggkorn')],
  // "sopp" must be whole-word — as a substring it swallows the pasta brand
  // "Sopps". "løsvekt" is deliberately absent: sweets are sold by it too.
  ['Frukt & grønt', word('sopp|sopper|champignon|gr(ø|oe)nnsaker|frukt')],
  ['Frukt & grønt', stem('nypoteter|sm(å|aa)tomater|cherrytomater|isbergsalat|hodekål|blomk(å|aa)l|brokkolini|sukkererter|gulr(ø|oe)tter')],
  ['Frukt & grønt', stem('tomat(er)?(?![a-zæøå])|salat(er)?(?![a-zæøå])|poteter?(?![a-zæøå])')],
  ['Frukt & grønt', word('epler?|p(æ|ae)rer?|bananer?|appelsiner?|klementiner?|mandariner?|druer|jordb(æ|ae)r|bl(å|aa)b(æ|ae)r|bringeb(æ|ae)r|plommer?|melon|vannmelon|ananas|mango|avokado|tomater?|agurk|salat|paprika|gulrot|l(ø|oe)k|poteter?|brokkoli|k(å|aa)l|spinat|squash|aubergine|mais|erter|b(ø|oe)nner|sitron|lime|ingef(æ|ae)r|hvitl(ø|oe)k|basilikum|persille|gartner')],
  ['Blomster & planter', stem('stilkblomst|kunstblomst|snittblomst|blomsterbukett|potteplante|krukkeplante|r(ø|oe)sslyng|julestjerne|orkid(e|é)|plantejord|blomsterpotte')],
  ['Blomster & planter', word('roser|tulipaner|blomster|bukett|lyng|planter|alstromeria|krysantemum|stemorsblomst')],
  ['Snacks & godteri', stem('potetgull|tortillachips|ostepop|saltstenger|peanøtter|peanoetter|godteposer|smågodt|sm(å|aa)godt|sjokolade|melkesjokolade|sjokoladeplate|lakris|tyggegummi|kjeks|digestive')],
  ['Snacks & godteri', word('chips|nachos|snacks|n(ø|oe)tter|cashew|mandler|godteri|kvikk ?lunsj|stratos|firkl(ø|oe)ver|daim|snickers|twix|bounty|toblerone|marabou|freia|nidar|smash|non ?stop|smarties|seigmenn|drops|pastiller|popcorn|oreo|bixit|ballerina|maarud|s(ø|oe)rlandschips|kims|brynild|safari')],
  ['Is & dessert', stem('iskrem|pinneis|b(å|aa)tis|krokanis|sm(å|aa)is|isb(å|aa)t|softis|karamellpudding|sjokolademousse|riskrem')],
  ['Is & dessert', word('is|diplom-?is|hennig-?olsen|magnum|dessert|pudding|fromasj|gel(e|é)')],
  ['Kaffe & te', stem('kaffekapsler|kaffeb(ø|oe)nner|filterkaffe|iskaffe|kaffefilter|kaffetrakter|espressokaffe|urtete|tebrev|sjokoladedrikk|kakaopulver')],
  ['Kaffe & te', word('kaffe|friele|evergood|nespresso|dolce ?gusto|espresso|nescaf(e|é)|te|lipton|twinings|pickwick|kakao|o.?boy|nesquik|starbucks')],
  // "-most" is Norwegian for pressed juice (eplemost, solbærmost). It is the
  // tail that made a generic "ost" stem unusable, so it belongs here instead.
  ['Drikke', stem('mineralvann|energidrikk|sportsdrikk|eplejuice|appelsinjuice|leskedrikk|alkoholfri|most(?![a-zæøå])')],
  ['Drikke', word('cola|coca-?cola|pepsi|fanta|sprite|solo|urge|brus|farris|imsdal|bonaqua|isklar|juice|jus|tropicana|sunniva|saft|iste|red ?bull|monster|battery|nocco|powerade|gatorade|(ø|oe)l|pils|cider|vin|smoothie|burn|pant')],
  ['Middag & ferdigmat', stem('grandiosa|pastasaus|ferdigrett|pytt i panne|pommes ?frites|nudelsuppe|fiskesuppe|kyllingwok|tacokrydder|tacolefser|tortillalefser')],
  ['Middag & ferdigmat', word('pizza|peppes|big ?one|lasagne|taco|enchilada|wok|gryte|gryter|suppe|supper|toro|fjordland|pai|pirog|dolmio|grateng|risotto|nudler|nissin')],
  ['Frysevarer', word('frossen|frosne|fryst|dypfryst|findus')],
  ['Tørrvarer & baking', stem('frokostblanding|havregryn|havregr(ø|oe)t|cornflakes|corn ?flakes|hvetemel|bakepulver|vaniljesukker|kakemiks|tomatpur(e|é)|kokosmelk|hakkede tomater|lasagneplater|jasminris|basmatiris|frokostkorn')],
  ['Tørrvarer & baking', word('pasta|spaghetti|makaroni|penne|fusilli|ris|couscous|bulgur|quinoa|linser|kikerter|hermetikk|m(ü|y)sli|musli|gr(ø|oe)t|sopps|barilla|mel|sukker|melis|gj(æ|ae)r|sirup|axa|4-?korn|havregr(ø|oe)t')],
  ['Saus & krydder', stem('soyasaus|chilisaus|hvitl(ø|oe)ksaus|tacosaus|salatdressing|olivenolje|rapsolje|matolje|buljongterning|krydderblanding')],
  ['Saus & krydder', word('ketchup|sennep|dressing|remulade|bearnaise|saus|sriracha|krydder|salt|pepper|buljong|olje|eddik|balsamico|idun|salsa|dip')],

  // --- non-grocery sectors ---
  ['Oppvarming', stem('panelovn|peisovn|vedovn|varmeovn|varmepumpe|varmekabel|varmelist|konvektor|oljefylt|badstue|skorstein|pipe(l(ø|oe)sning)?|r(ø|oe)ykr(ø|oe)r')],
  ['Oppvarming', word('dovre|jøtul|j(ø|oe)tul|nobø|nob(ø|oe)|beha|mill|adax|glamox')],
  ['Smarthus & sikkerhet', stem('d(ø|oe)rl(å|aa)s|fingeravtrykksl(å|aa)s|kodel(å|aa)s|smartl(å|aa)s|d(ø|oe)rautomatikk|innbruddsalarm|r(ø|oe)ykvarsler|overv(å|aa)kingskamera|dørklokke|d(ø|oe)rklokke|smartplugg|smartpære|wifi')],
  ['Smarthus & sikkerhet', word('nimly|yale|doorman|invisible|brannslukker|alarm')],
  ['Leker & spill', stem('brettspill|puslespill|kosedyr|dukkevogn|byggekloss|leketøy|leket(ø|oe)y')],
  ['Leker & spill', word('lego|playmobil|barbie|leker|spill|puslespill')],
  ['Bygg & jernvare', stem('vinylgulv|eikegulv|laminatgulv|heltregulv|gulvbord|dempelist|gulvlist|st(ø|oe)per(ø|oe)r|st(ø|oe)pem(ø|oe)rtel|m(ø|oe)rtel|kappsag|gj(æ|ae)rsag|bordsag|betongblander|takplate|takrenne|membran|fugemasse|silikon|sparkel')],
  ['Bygg & jernvare', word('pergo|isola|scheppach|robust|finert|gulv')],
  // 'bygg' alone is also the grain (byggryn, byggmel), so only the
  // construction compounds are matched here.
  ['Bygg & jernvare', stem('byggevare|byggefag|byggvare|byggmateriale|verkt(ø|oe)y|batteridrill|skrutrekker|vinkelsliper|stikksag|sirkelsag|m(å|aa)leb(å|aa)nd|arbeidsbukse|arbeidsjakke|vernesko|vernebriller|malings?|grunning|treolje|terrassebeis|isolasjon|gipsplate|konstruksjonsvirke|terrassebord|impregnert|sement|betong|fliser|flislim|laminat|parkett|takrenne|takstein|r(ø|oe)ropplegg|sanit(æ|ae)r|blandebatteri|dusjkabinett|servant|toalettskål|stikkontakt|skj(ø|oe)teledning|lysarmatur')],
  ['Bygg & jernvare', word('maling|beis|lakk|pensel|skruer|spiker|hammer|stige|planke|gips|drill|sag|list|lister|kran|vask')],
  // "oppvaskmaskin" is spelled without the linking -e, so a "vaskemaskin" stem
  // never reaches it; it needs its own alternative.
  ['Elektronikk', stem('h(ø|oe)yttaler|soundbar|hodetelefoner|(ø|oe)replugger|smartklokke|powerbank|robotst(ø|oe)vsuger|st(ø|oe)vsuger|kaffemaskin|mikrob(ø|oe)lgeovn|airfryer|air ?fryer|oppvaskmaskin|vaskemaskin|t(ø|oe)rketrommel|kj(ø|oe)leskap|fryseboks|induksjonstopp|gamingstol|gamingbord|skrivebordslampe')],
  ['Elektronikk', word('tv|fjernsyn|airpods|mobil|iphone|samsung|laptop|pc|nettbrett|ipad|skjerm|monitor|kamera|lader|usb|ruter|playstation|xbox|nintendo|konsoll')],
  ['Sport & fritid', stem('sykkelhjelm|l(ø|oe)pesko|joggesko|treningst(ø|oe)y|sportsutstyr|skist(ø|oe)vler|fiskestang|sovepose|tursekk|ryggsekk|yogamatte|treningsapparat|h(å|aa)ndvekter|medlemskap|treningssenter')],
  ['Sport & fritid', word('sykkel|ski|slalom|fotball|h(å|aa)ndball|basketball|golf|telt|termos|manualer|fitness|gym|evo')],
  ['Klær & sko', stem('t-?skjorte|undert(ø|oe)y|regnt(ø|oe)y|ytterjakke|dunjakke|softshell|joggebukse|strømpebukse|str(ø|oe)mpebukse|badeshorts|badedrakt')],
  ['Klær & sko', stem('sokker|str(ø|oe)mper|sandal(er)?|fritidssko|joggesko|regnponcho|regnjakke|vinterjakke|softshelljakke|leggings|bodystocking')],
  ['Klær & sko', word('jakke|bukser?|genser|skjorte|kjole|truser?|bh|pyjamas|sko|st(ø|oe)vler|lue|votter|skjerf|kl(æ|ae)r|caps|skogstad|okidoki|northpeak|puma|adidas|nike')],
  ['Hage & uterom', stem('hagem(ø|oe)bler|gassgrill|kullgrill|grillkull|briketter|hageslange|gressklipper|hekksaks|l(ø|oe)vblåser|parasoll|hammock|badebasseng|terrassevarmer|plantekasse|gj(ø|oe)dsel')],
  ['Hage & uterom', word('grill|hagebord|hagestol|jord|utep(ei|ei)s')],

  // --- long tail: brands and single-item clusters found by frequency analysis ---
  ['Personlig pleie', word('jordan|max ?factor|loreal|l.oreal|maybelline|rimmel|garnier|head ?& ?shoulders')],
  ['Apotek & helse', stem('vaginalkrem|overgangsalder|smertestillende|reseptbelagt')],
  ['Snacks & godteri', word('kinder|toms|nidar|sørlandschips|kims|pringles')],
  ['Blomster & planter', word('calluna|erica|krukke')],
  ['Kjøkken & servering', stem('rivjern|glassboks|oppbevaringsboks|smartstore|brødrister|br(ø|oe)drister|vannkoker|kj(ø|oe)kkenarmatur|kj(ø|oe)kkenvekt')],
  ['Husholdning', stem('kleshenger|t(ø|oe)rkestativ|avfallspose|vaskeb(ø|oe)tte|superkost|kost(er)?(?![a-zæøå])')],
  ['Bygg & jernvare', stem('h(ø|oe)ytrykksspyler|bormaskin|b(ø|oe)rster til|sandpapir|fasadevask|hengel(å|aa)s|borrel(å|aa)s|armatur|slangetrommel|stillas|arbeidslampe')],
  ['Sport & fritid', stem('leggskinn|bakskifter|framskifter|skjermsett|sykkeldeler|sykkelhjul|sykkelpumpe|treningsstr(ø|oe)mper')],
  ['Hage & uterom', stem('hagetrommel|pizzaovn|utepeis|b(å|aa)lpanne|terrassevask|plantekrukke')],
  ['Hage & uterom', word('cozze|terrasse|trolla')],
  ['Elektronikk', stem('laserskriver|blekkskriver|skriver(?![a-zæøå])|printer|h(ø|oe)yttalere')],
];

export const CATEGORIES = [...new Set(RULES.map(([c]) => c)), 'Annet'];

function match(text) {
  if (!text) return null;
  for (const [cat, re] of RULES) if (re.test(text)) return cat;
  return null;
}

/**
 * Classify an offer. The name is the signal; the description is only a
 * fallback, because pooled marketing copy hijacks categories otherwise
 * ("naturlig rik på omega-3" once turned tinned mackerel into medicine).
 * Called with a single combined string it still behaves sensibly.
 */
export function categorize(name, description = '') {
  return match(name) ?? match(description) ?? 'Annet';
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
  'Selfmade': 'Lavpris & variert',
  'Biltema': 'Bygg & jernvare', 'MAXBO': 'Bygg & jernvare', 'Byggmakker': 'Bygg & jernvare',
  'Byggmax': 'Bygg & jernvare', 'Coop Byggmix': 'Bygg & jernvare', 'Obs! Bygg': 'Bygg & jernvare',
  'jem & fix': 'Bygg & jernvare', 'Megaflis': 'Bygg & jernvare', 'Jernia': 'Bygg & jernvare',
  'Byggfag': 'Bygg & jernvare', 'Right Price Tiles': 'Bygg & jernvare',
  'Monter': 'Bygg & jernvare', 'NorBo1': 'Bygg & jernvare', 'thansen': 'Bygg & jernvare',
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
const GENERIC_FIRST = word('norske?|fersk|ferske|frossen|frosne|(ø|oe)kologisk|utvalgte|diverse|flere|store|sm(å|aa)|hele|nye|ekstra|super|mega|billig|nyhet|ukens|alle|div|kun|nå|na');

export function extractBrand(text) {
  const first = String(text ?? '').trim().split(/[\s,/]+/)[0] ?? '';
  if (first.length < 2 || GENERIC_FIRST.test(first)) return null;
  if (!/^[A-ZÆØÅ]/.test(first)) return null;
  const clean = first.replace(/[^\wÆØÅæøå'&.-]/g, '');
  // All-caps headings ("LAKSEFILET") are product names, not brands.
  if (clean === clean.toUpperCase() && clean.length > 4) return null;
  return clean || null;
}
