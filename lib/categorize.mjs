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
// Rules are ordered and first match wins. Specific equipment and product
// heads outrank loose material, ingredient and brand matches. Anything unmatched stays 'Annet'
// rather than being forced into a category it does not belong to.

const WORD_CHAR = 'a-zA-ZæøåÆØÅ0-9';

/** Whole-word match, Norwegian-aware. word('te') matches "te", not "søte". */
const word = pattern => new RegExp(`(?<![${WORD_CHAR}])(?:${pattern})(?![${WORD_CHAR}])`, 'i');

/** Substring match, for stems that appear inside compounds (VEGG·LAMPE). */
const stem = pattern => new RegExp(`(?:${pattern})`, 'i');

const LEGACY_RULES = [
  // --- narrow categories first: these words also appear in broader ones ---
  ['Barn & baby', word('baby\\w*|barnemat|barnegr(ø|oe)t|sm(å|aa)barn\\w*|velling|morsmelk\\w*|bleier?|pampers|libero|t(å|aa)teflaske|smokk|barnekjeks|smoothiebiter|nestl(e|é)|hipp|semper')],
  ['Dyr', stem('hundemat|kattemat|hundefor|kattefor|kattesand|hundegodt|tyggeben|kattetre|hundeb(å|aa)nd|dyrefor|fuglefr(ø|oe)|akvarie')],
  ['Dyr', word('whiskas|pedigree|royal ?canin|pussi|purina|felix')],
  ['Apotek & helse', stem('kosttilskudd|proteinpulver|vitamintilskudd|hostesaft|halstablett|nesespray|reseptfri')],
  ['Apotek & helse', word('paracet\\w*|ibux|apotek|plaster|probiotika|elektrolytter?')],

  // --- personal care and household: distinctive, low collision risk ---
  ['Personlig pleie', stem('shampo|balsam|h(å|aa)rfarge|dusjs(å|aa)pe|dusjgel|h(å|aa)nds(å|aa)pe|deodorant|antiperspirant|tannkrem|tannb(ø|oe)rste|tanntr(å|aa)d|munnskyll|truseinnlegg|barberh(ø|oe)vel|barberskum|barberblad|hudkrem|bodylotion|solkrem|fuktighetskrem|ansiktsmaske|leppestift|neglelakk|mascara|sminke|parfyme|v(å|aa)tservietter')],
  ['Personlig pleie', word('nivea|colgate|gillette|always|libresse|q-?tips|bind|tamponger?|dove|axe|old spice')],
  ['Husholdning', stem('vaskemiddel|t(ø|oe)yvask|skyllemiddel|oppvask(?!maskin)|maskinoppvask|rengj(ø|oe)ring|allrent|t(ø|oe)rkerull|husholdningspapir|toalettpapir|dopapir|s(ø|oe)ppelsekk|s(ø|oe)ppelpose|fryseposer|plastposer|aluminiumsfolie|matpapir|bakepapir|stearinlys|telys|vaskeklut|luftfrisker|st(ø|oe)vklut')],
  ['Husholdning', word('zalo|omo|milo|blenda|ariel|jif|klorin|ajax|serviett(er)?|kluter|sv(a|æ)mper?|batterier?')],

  // --- lighting before furniture: a GULVLAMPE is not a GULVTEPPE ---
  ['Belysning', stem('lampe|lampett|lysekrone|pendel|spotplate|spotrekke|enkelspot|lyslenke|lysslynge|utebelysning|taklys|leselys')],
  ['Belysning', word('spot|spotter|pendler|lyspunkt')],

  // --- furniture and interior: head noun sits at the end of the compound ---
  ['Møbler & interiør', stem('sofa|l(e|æ)nestol|spisestol|kontorstol|barstol|gyngestol|nattbord|sidebord|sofabord|spisebord|skrivebord|konsollbord|salongbord|trekrakk|krakk|vegghylle|bokhylle|garderobe|kommode|skjenk|vitrine|sengegavl|overmadrass|madrass|sengesett|senget(ø|oe)y|dyne\\w*|putetrekk|hodepute|hotellpute|gulvteppe|d(ø|oe)rmatte|gardin\\w*|persienne|speil|bilderamme|lysestake|vase|skittent(ø|oe)yskurv|oppbevaringskurv|puff|benk|reol|stativ|knagg')],
  ['Møbler & interiør', stem('kontinentalseng|rammeseng|seng(eramme|epakke)|hvilestol|recliner|sovesofa|hj(ø|oe)rnesofa|spisegruppe|salongsett|skohylle|skjenkeskap|tv-?benk')],
  ['Møbler & interiør', word('seng|senger|stol|stoler|bord|teppe|tepper|pute|puter|skap|hylle|hyller|kurv|diffuser|duft(lys|pinner)?|seter|seteputer')],
  ['Kjøkken & servering', stem('kasserolle|stekepanne|grytesett|kjelesett|tallerken|bestikk|kj(ø|oe)kkenredskap|skj(æ|ae)refjel|kniv(sett|blokk)|vinglass|drikkeglass|kaffekopp|krus|serveringsfat|bollesett|formsett|termos|matboks|drikkeflaske')],

  // --- food: brands and product nouns ---
  // -ost compounds are enumerated rather than matched by a generic "ost" tail:
  // any lookbehind cheap enough to write still let "EPLEMOST" and "frost"
  // through, and a juice filed under cheese is worse than one left in 'Annet'.
  ['Ost', stem('salatost|pizzaost|revetost|revet ?ost|sm(ø|oe)reost|kremost|fl(ø|oe)teost|fetaost|gulost|hvitost|brunost|geitost|pult(o)?st')],
  ['Ost', word('ost|oster|norvegia|jarlsberg|gudbrandsdalsost|fl(ø|oe)temysost|cheddar|brie|camembert|feta|apetina|mozzarella|parmesan|snøfrisk|sn(ø|oe)frisk|philadelphia|port ?salut|kremgo')],
  ['Meieri & egg', stem('lettmelk|helmelk|skummetmelk|melkedrikk|drikkeyoghurt|yoghurt|matfl(ø|oe)te|kremfl(ø|oe)te|kaffefl(ø|oe)te|r(ø|oe)mmedressing|kulturmelk|cottage')],
  ['Meieri & egg', word('melk|yoghurt|skyr|kvarg|yoplait|activia|biola|kefir|go.?morgen|r(ø|oe)mme|cr(e|è)me ?fra(i|î)che|fl(ø|oe)te|kesam|sm(ø|oe)r|margarin|brelett|melange|egg|q-?melk')],
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
  ['Snacks & godteri', word('chips|nachos|snacks|n(ø|oe)tter|cashew|mandler|godteri|kvikk ?lunsj|stratos|firkl(ø|oe)ver|daim|snickers|twix|bounty|toblerone|marabou|freia|nidar|smash|non ?stop|smarties|seigmenn|drops|pastiller|popcorn|oreo|bixit|ballerina|maarud|s(ø|oe)rlandschips|kims|brynild')],
  ['Is & dessert', stem('iskrem|pinneis|b(å|aa)tis|krokanis|sm(å|aa)is|isb(å|aa)t|softis|karamellpudding|sjokolademousse|riskrem')],
  ['Is & dessert', word('is|diplom-?is|hennig-?olsen|magnum|dessert|pudding|fromasj|gel(e|é)')],
  ['Kaffe & te', stem('kaffekapsler|kaffeb(ø|oe)nner|filterkaffe|iskaffe|espressokaffe|urtete|tebrev|sjokoladedrikk|kakaopulver')],
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

// The product head outranks ingredients/brands: ølglass is equipment, while
// vedfyrt pizza is food. Do not promote an unknown appliance from marketing copy.
const FOOD_CATEGORIES = new Set([
  'Ost', 'Meieri & egg', 'Fisk & sjømat', 'Kjøtt & fjørfe', 'Pålegg',
  'Brød & bakeri', 'Frukt & grønt', 'Snacks & godteri', 'Is & dessert',
  'Kaffe & te', 'Drikke', 'Middag & ferdigmat', 'Frysevarer',
  'Tørrvarer & baking', 'Saus & krydder', 'Dyremat',
]);
const CONSUMABLE_CATEGORIES = new Set(['Husholdning', 'Personlig pleie', 'Barn & baby']);

// Equipment heads veto ingredient/consumable matches even in mixed retailers.
// Do not use a bare "sett" or "maskin" substring: pålegg-sett and
// maskinoppvasktabletter are consumables, not appliances or toys.
const NON_GROCERY_HEAD_RULES = [
  ['Leker & spill', stem('play[- ]?doh|fisher[- ]?price|plush|plysj|leke(sett|figur|mat|kjøkken)|iskremsett|pizzasett')],
  ['Sport & fritid', word('airbrush')],
  ['Bygg & jernvare', stem('(bor|slipe|pusse)maskin')],
  ['Sport & fritid', stem('(sy|ro)maskin')],
  ['Elektronikk', stem('[a-zæøå]+[- ]?maskin(?![a-zæøå])')],
  ['Kjøkken & servering', stem('(champagne|vin|øl|drikke|serverings)glass|glass[- ]?sett|skj(æ|ae)re(plate|brett)')],
  ['Møbler & interiør', stem('(lys|telys|stearinlys)holder')],
  ['Hjem & oppbevaring', stem('(?<![a-zæøå])(?!(inne|be)holder)[a-zæøå]+holder(e|en|ne)?(?![a-zæøå])')],
  ['Bygg & jernvare', word('klammer')],
  ['Hage & uterom', word('rive|river')],
  ['Bil & motor', stem('avfetting')],
  ['Bygg & jernvare', stem('vernesko')],
  ['Klær & sko', stem('[a-zæøå]*(sko|st(ø|oe)vel|st(ø|oe)vler|boots?)(?![a-zæøå])')],
];

const EQUIPMENT_RULES = [
  ['Leker & spill', stem('barnevogn|lekegrind|babygym|bitering|rangle|baby born|baby einstein|sansematte|clementoni|silverlit|squishy|sprettball|klistremerkebok|dominotog|barnetraktor|foam clay|store figurer|djevelsett|djevel sett|bursdagsartikler')],
  ['Hjem & oppbevaring', stem('mikrofibermopp|balje|feiesett|moppeskaft|vaske(b(ø|oe)tte|sett)|s(å|aa)pedispenser|skoboks|flytteeske|oppbevarings')],
  ['Elektronikk', stem('foodprocessor|stavmikser|minihakker|multihakker|slushmaskin|sous vide|vakuumpakker|overv(å|aa)kningskamera|dyson|oral[- ]?b.+(pro|io[0-9 ]|elektr)|sensor.+s(å|aa)pedispenser')],
  ['Møbler & interiør', stem('barneseng|barnestol|ergonomisk.+pute|sm(å|aa)bord|bordsett|hodegavl|sengegavl|gavl|hattehylle|stumtjener|ileggsplate|fiberpute|spisebrikke|all(e|t) dun|bladlampe|skinnteppe')],
  ['Kjøkken & servering', stem('br(ø|oe)dkniv|kokk+ekniv|santukokniv|skrellekniv|sm(ø|oe)rkniv|tomatkniv|skj(æ|ae)refj(ø|oe)l|serveringsfj(ø|oe)l|aluminiumsg ryte|aluminiumsgryte|snurrebrett|springform|muffinsform|trykkoker|stekegryte|fruktkvern|fruktplukker|b(æ|ae)rrenser|termoflaske|termokopp|servise|glasskrukke|startsett kj(ø|oe)kken|rosti.+skj(æ|ae)rer')],
  ['Kjøkken & servering', word('forkle|brett|fat|aluminium.?former|aluminumsformer')],
  ['Bygg & jernvare', stem('oljebeis|takpanne|trappevange|arbeidsbukk|arbeidsbenk|verkt(ø|oe)y|kjedesag|eksentersliper|multisliper|hellerenser|walls2paint|gulvspon|nordsj(ø|oe)|huntonit|forestia|rectified|mosaik|glansgrader|beisekost|bobl(e|a)plast|platekapp|bj elkesko|bjelkesko|forlengerskaft|m(ø|oe)neplate|terskel|veggplate|trefib|impregnering|hengsler|infravarmer|hultafors|trykkimpregnert|hobbyplate|teknos')],
  ['Belysning', stem('h(å|aa)ndlykt|nordlux|lykte|lanterne|lanternes')],
  ['Sport & fritid', stem('pilates|treningsstrikk|bumbag|haspelsett|paraply|malelerret|akvarell|blonde|b(å|aa)nd .{0,15}[0-9]|fiskesnelle|fiskesn(ø|oe)re|fiskekrok|sluk|fiskesett|gummib(å|aa)t|toalettmappe')],
  ['Klær & sko', stem('hettegenser|poloskjorte|baselayer|belte|blinkesko|badek(å|aa)pe|friluftsbukse|friluftskl(æ|ae)r|friluftsgenser|t(ø|oe)ffel')],
  ['Bil & motor', stem('wd[- ]?40|baklykt|bunnplugg|b(å|aa)tpolish|gelcoat|dragtrekk|jumpstarter|insekt.?fjerner|ceramic.+(wax|coating)|rensemiddel.+bil')],

  ['Bil & motor', stem('spylerv(æ|ae)ske|motorolje|motor olje|vindusvisker|viskerblad|bilpleie|bilshampo|bilvask|bilpolish|bilbatteri|bilstereo|bilmatter|bildekk|bilsete|takboks|turtle wax|wheel cleaner|is[- ]?skrape|frostv(æ|ae)ske|kj(ø|oe)lev(æ|ae)ske|bremsev(æ|ae)ske|bremserens|diesel|bensin|tennplugg|(?<!s)jekk|startkabel|(?<!marmor)felg|sn(ø|oe)kjett|dekktryk|tilhenger|tilhengerkobl|rustbeskytt|castrol|adblue|alkylat')],
  ['Dyreutstyr', stem('kattetre|hundeb(å|aa)nd|halsb(å|aa)nd|hundesele|hundeseng|katteseng|kattesand|kattelek|hundelek|kattehus|klorestativ|klorebrett|akvari|fuglebur|transportbur|kattetoalett|hundepose|hundebleie')],
  ['Hjem & oppbevaring', stem('oppbevaring|smartstore|store it|vaskeb(ø|oe)tte|b(ø|oe)tter?|kleshenger|t(ø|oe)rkestativ|toalettb(ø|oe)rste|gulvmopp|moppesett|superkost|feiekost|feiebrett|st(ø|oe)vkost|klesrulle|skittent(ø|oe)yskurv|kurv|organizer|organiser|handlenett|baderomstilbeh(ø|oe)r|s(ø|oe)ppelb(ø|oe)tte|avfallsb(ø|oe)tte|avfallsdunk|vaskefat|skittent(ø|oe)y')],
  ['Elektronikk', stem('skot(ø|oe)rker|kaffetrakter|kaffemaskin|br(ø|oe)drister|vannkoker|kj(ø|oe)kkenmaskin|kj(ø|oe)kkenvekt|eggkoker|ismaskin|isbitmaskin|isbitsmaskin|riskoker|multikoker|blender|kj(ø|oe)kkenventilator|ventilator|kj(ø|oe)kkenvifte|t(ø|oe)rkeskap|kombiskap|fryseskap|kj(ø|oe)lefrys|minikj(ø|oe)ler|komfyr|stekeovn|dampovn|microb(ø|oe)lge|mikroovn|vaffeljern|elektrisk tannb(ø|oe)rste|barbermaskin|h(å|aa)rf(ø|oe)ner|h(å|aa)rf(ø|oe)hner|rettetang|varmluftsb(ø|oe)rste|h(å|aa)rklipper|epilator|steam(er|mopp)|airfry|luftrenser|luftfukter|avfukter|headset|keyboard|tastatur|datamus|tr(å|aa)dl(ø|oe)s mus|smartwatch|gaming|chromebook|macbook|thinkpad|ideapad|vivobook|zenbook|aspire|galaxy|smarttelefon|smart-tv|apple watch|photo ?frame|frameo|ørepropper|h(ø|oe)retelefon|router|wi-?fi|kabel usb|usb[- ]|ssd|harddisk|minnekort|kalkulator|blekkpatron|toner|radio|dreame|roborock|ecovacs|el-sparkesykkel')],
  ['Elektronikk', word('acer|lenovo|dell|asus|ipad|iphone|airpods|imac|mac|vr|ps5|ps4|oled|qled|chromecast|nvidia|geforce|garmin|fitbit|gopro|webkamera|tv-er|tv.+tommer')],
  ['Oppvarming', stem('ildsted|peisinnsats|peis.?ovn|ved.?ovn|panel.?ovn|varme.?ovn|varmepumpe|konvektor|radiator|varmevifte|vifteovn|oljefylt|oljefri|pipehatt|r(ø|oe)ykr(ø|oe)r|r(ø|oe)kr(ø|oe)r')],
  ['Oppvarming', word('ovn|ovner|peis|peiser|ovnssett')],
  ['Kjøkken & servering', stem('(ø|oe)lglass|osteh(ø|oe)vel|kaffefilter|pizzaspade|pizzaskj(æ|ae)rer|pizzastein|pizzasteen|kakeform|br(ø|oe)dform|ildfast|ildfaste|langpanne|bakeform|salatbestikk|eggeglass|eggedeler|eggeskj(æ|ae)rer|fruktpresse|b(æ|ae)rplukker|gr(ø|oe)nnsakskutter|minikutter|hamburgerpresse|potetskreller|potetpresse|kakespade|sausekjele|kjeler?|stekepanner?|st(ø|oe)pejernsgryte|gryteklut|grytevott|morter|silikonform|krydderkvern|pepperkvern|saltkvern|flaske(å|aa)pner|korketrekker|kj(ø|oe)kkensaks|kj(ø|oe)kkenkniv|bakebolle|vispebolle|salatbolle|skj(æ|ae)rebrett|drikkeflaske|glass fra|maku kitchen|serveringssett|karaffel|karafler|presskanne|steketermometer|knivsliper|kaffe(kanne|press|m(ø|oe)lle)|kj(ø|oe)ttkvern|norgesglass')],
  ['Kjøkken & servering', word('glass|glassene|glassett|sk(å|aa)l|sk(å|aa)ler|visp|sleiv|stekespade|stekepose|melamin|rosendahl|riedel|sabor|eva solo|eva trio|gryt(er|e)|wokpanne|kitchen')],
  ['Hage & uterom', stem('pizzaovn(?![- ]pizza)|gassgrill|kullgrill|grillrist|grilltrekk|grillstarter|utepeis|b(å|aa)lpanne|grillplate|peisved|vedsekk|hage|uterom|sammenleggbar grill|sn(ø|oe)freser|gressklipper|robotklipper|ryddesag|kantklipper|hekksaks|beskj(æ|ae)rings|hagesaks|l(ø|oe)vbl(å|aa)ser|l(ø|oe)voppsaml|vannspreder|vannings|presenning|trilleb(å|aa)r|trampolin|kompost|parasoll|badebasseng|paviljong|balkongsett|utestol|utegruppe|utesofa|solseng|sn(ø|oe)m(å|aa)ke|sn(ø|oe)skuffe|sn(ø|oe)rydd|spade|jordfreser|jordanker|redskapsbod|drivhus')],
  ['Bygg & jernvare', stem('ytterd(ø|oe)r|innerd(ø|oe)r|inngangsd(ø|oe)r|skyved(ø|oe)r|brannd(ø|oe)r|d(ø|oe)rblad|d(ø|oe)rkarm|d(ø|oe)rh(å|aa)ndtak|d(ø|oe)rvrider|d(ø|oe)rpakning|vinduer|vindusglass|bygge|byggskum|osb|rupanel|tregulv|gulvplate|gulvunderlag|k-virke|konstruksjon|mosaikk|fasade|taktet|takpapp|takshing|trepanel|veggpanel|akustikkpanel|gips|fukt|fuge|flis|flise|baderom|baderoms|badekar|baderomsinnredning|dusjsett|dusjd(ø|oe)r|dusjhj(ø|oe)rne|dusjvegg|dusjarm|dusjpanel|dusjhode|dusjstang|dusjslange|dusjgarnityr|dusjbatteri|dusjtermostat|dusjkar|blandebatteri|servant|wc[- ]|toalettsete|toalettlokk|veggsk(å|aa)l|vaskeskap|avl(ø|oe)psr(ø|oe)r|r(ø|oe)rfitting|kuleventil|kobberr(ø|oe)r|drener|vannr(ø|oe)r|benkeplate|sikkerhetsbryter|kabeltrommel|skj(ø|oe)tekabel|st(ø|oe)psel|bits|multiverkt(ø|oe)y|fugepistol|spikerpistol|borhammer|h(ø|oe)ytrykk.?spyler|skumkanon|st(ø|oe)vsugerpose|dykksag|kompressor|rullesett|treolje|(?<!barber)h(ø|oe)vel|h(ø|oe)vlet|slipemaskin|slagdrill|slipestift|nagle|bolter|mutter|pakning|kobling|st(å|aa)ltr(å|aa)d|st(å|aa)lwire|tvinge|hull.?sag|laseravstand|torx|pipel(ø|oe)sning|pipevinkel|pipen(ø|oe)kkel|pipehylse|r(ø|oe)rtang|skiften(ø|oe)kkel|unbrako|filsett|arbeidshanske|verne|h(ø|oe)rselvern|plank|kryssfiner|sponplate|grunnmur|m(ø|oe)rtel|belegningsstein|allmarble|mystone|rockstone')],
  ['Bygg & jernvare', word('treolje|d(ø|oe)r|d(ø|oe)rer|kraner|kranen|grohe|hansgrohe|gustavsberg|celeste|celest|lume|grohtherm|hansgrohe|flislim|krom|leca|sika|fibo|jotun|lady|drygolin|butinox|akrylglass|spon|virke|trelast|terrassebeis|hey.di|hey\x27di|weber|dremel|milwaukee|dewalt|makita|metabo|hultafors|stanley')],
  ['Belysning', stem('lysp(æ|ae)re|lysr(ø|oe)r|led.?p(æ|ae)re|hodelykt|lommelykt|ringlys|plafond|uplight|led[- ]lys|arbeidslampe|stearinlys.+led|telys.+led|led.+telys|led.+kubbelys')],
  ['Møbler & interiør', stem('pyntepute|puter|ullteppe|pledd|h(å|aa)ndkl(æ|ae)r|h(å|aa)ndkle|badelaken|frott(e|é)|duker|bordduk|l(ø|oe)per|bade.?matte|lammeskinn|loungestol|kontinental|sengebunn|sengeben|sengeramme|rammemadrass|h(ø|oe)yskap|skrivepult|pynte|dekor|serviettring|duftpinne|bambusgardin|plisse|rullegardin|rullgardin|liftgardin|kommode|sittegruppe|sittebenk|stue.?bord|stolpute|putevar|sengepakke')],
  ['Blomster & planter', stem('gr(ø|oe)nnplante|blomst|blomster|rosebukett|rosemiks|rosebusk|hortensia|alpefiol|sansevieria|monstera|pelargoni|lavendel|chrysant|dekorasjonsgress|sypress')],
  ['Klær & sko', stem('barnesko|babysko|barnekl(æ|ae)r|babykl(æ|ae)r|barnejakke|babyjakke|barnegenser|ullgenser|ulltr(ø|oe)ye|ullhals|ullundert|ull.?sokk|sokk|ullongs|longs|boxer|t.?shirt|jersey|sneakers?|st(ø|oe)vel|gummist(ø|oe)vel|slippers|t(ø|oe)fler|hansk(er|e)|regnsett|regndress|parkdress|vinterdress|balaclava|skalljakke|fleece|fleecejakke|pysj|pysjamas|shorts|topper|singlet|collegegenser|sport-bh|bra |sweatshirt|sweatpants|hoodie|vest|halst(ø|oe)rkle|panneb(å|aa)nd|bunad|nettingtr(ø|oe)ye|tights|tursko|turst(ø|oe)vel|arbeidst(ø|oe)y')],
  ['Klær & sko', word('reima|hummel|asics|tretorn|didriksons|helly hansen|pierre robert|neopren|cherrox|heldre|svetta|jeans|bluse|cardigan|blazer|skj(ø|oe)rt|k(å|aa)pe|dress|overdel|joggedress|poncho|joggesett|st(ø|oe)vlett|tunika|pullover|st(ø|oe)vler|hatt|treningstr(ø|oe)ye')],
  ['Sport & fritid', stem('kettlebell|sparkesykkel|barnesykkel|junior.?sykkel|balansesykkel|sykkell(å|aa)s|sykkel|gymbag|sportbag|treningsmatte|fitnessmatte|n(ø|oe)kkelring|drikkesekk|tursekk|skolesekk|skolesek|sekk sport|barnehagesekk|ryggsekk|bagasje|koffert|camping|liggeunderlag|luftmadrass|padel|kajakk|paddle|supbrett|tursk(i|o)|langrenn|rulleski|skism(ø|oe)ring|turstol|turkj(ø|oe)kken|stormkj(ø|oe)kken|gassbrenner|primus')],
  ['Elektronikk', stem('h(å|aa)ndmikser|toastjern|sandwichjern|pepperkoker|hot air styler|hair straightener|hellacool|bordgrill|raclettegrill')],
  ['Møbler & interiør', stem('hj(ø|oe)rnebord|settbord|pidestall|spisebrikke|fiberpute|stressless|h(ø|oe)gsk.?p|ottoman|lenestol|salong|bokreol|hvilemodul')],
  ['Hjem & oppbevaring', stem('vindusnal|gulvnal|nal med|glasskrukke')],
  ['Sport & fritid', stem('tredem(ø|oe)lle|trimsykkel|ergometersykkel|romaskin|manualsett|drikkebelte|spirall(å|aa)s|kretspapir|karabinkrok|sekker|smykker|armb(å|aa)nd|brille|aktivitets|malelerret')],
  // Craft materials and stationery share the existing leisure category.
  ['Sport & fritid', stem('strikkepinn|rundpinn|str(ø|oe)mpepinn|hæklenål|heklen(å|aa)l|strikkegarn|broder|sytr(å|aa)d|symerke|sytilbeh(ø|oe)r|tekstil|viskose|bomull|jersey|denim|fl(ø|oe)yel|velour|gobelin|linlook|imitert|canvas|stretch|vevet|v(æ|ae)vet|garn|glidel(å|aa)s|m(ø|oe)nsterpapir|sysett|symaskin|perle|syknapp|søm|s(ø|oe)lvfarget|gullfarget|fraya|prym|addi|viledon|viselin|hemline|ullstoff|metervare|silkestoff|offwhite|strykestoff|imitationspels|boucle|teddy|hulls|huls|syb(å|aa)nd|b(å|aa)nd vevet|satinb(å|aa)nd|trykknapp|n(å|aa)lesett|saks|tr(å|aa)dsnelle|elastikk|buksestrikk')],
  ['Sport & fritid', stem('blyant|fargeblyant|kulepenn|viskel(æ|ae)r|pennal|hefte|kopipapir|bokbind|tegne|malebok|tusjer|fargepenn|marker|papirark|skrivebok|notatbok|notatblokk|magnetblokk|tape|limstift|kalk(er|ering)|bullet journal|skissebok|skolebok|boksekk|penselsett')],
  ['Leker & spill', stem('lekeleire|modelleire|slime|metallbil|lekebil|hot wheels|samlefigur|aktivitet[s]?bok|aktivitetshefte|fidget|glowstick|ballong|halloween|lekesett|lekehus|leketelt|lekekj(ø|oe)kken|vannpistol|s(å|aa)pebobl|actionfigur|sparkebil|barnebil|kritt|badeleke|dukk(e|er)|figursett|returball|4 p(å|aa) rad')],
];

const CONSUMABLE_RULES = [
  ['Personlig pleie', stem('stylingprodukt|stylingkrem|stylinggel')],
  ['Husholdning', stem('br(ø|oe)dpose|superklut|pink stuff|sportsvask|serla|maximeter|proff akti(v|ve) ?gel|biotex|cillit bang|domestos|avfallsekk|dokalk|eazycover|re ngj')],
  ['Personlig pleie', stem('sjam(p|b)o|sjampo|leppepomade|carmex|h(å|aa)rstrikk|intims(å|aa)pe|trippe(ld|l)d usj|trippeldusj|shower gel|okeeffe|o.keeffe|john frida|l(ö|ø)wengrip|ida warg|la.dor|physicians formula|shave gel|starter kit estrid|lotion|primer|moisturi[sz]er|highlighter|isadora|eye patch|brilliant smile')],

  ['Husholdning', stem('t(ø|oe)ymykner|flekkfjerner|co(o|op) flekke?fjerner|gulvspray|bakeark|plastfolie|kleenex|fresh discs|lambi|finish|sun maxpower|oppvasktablett|oppvaskpulver|A\+.*(flytende|pulver|kapsler)|a\+ pure senses')],
  ['Husholdning', word('batteri|batterier|battery max')],
  ['Personlig pleie', stem('babyolje|asan|apobase|flux|fluorskyll|parodontax|nattbind|wipes|cleansing|conditioner|nutrisse|neglelakk|nail|bronzing|bondi sands|sensilis|cosrx|la roche|bioderma|vichy|av(e|è)ne|shiseido|clinique')],

  ['Barn & baby', stem('barnemat|barnegr(ø|oe)t|morsmelk|velling|bleier?|bleiebukse|pampers|libero|baby.+v(å|aa)tserviett|sm(å|aa)barnsmat|barnekjeks|smoothiebiter|klemmeposer')],
  ['Dyremat', stem('hundemat|kattemat|hundef(o|ô|ó|ò|ö|ø)r|kattef(o|ô|ó|ò|ö|ø)r|t(ø|oe)rrf(o|ô|ó|ò|ö|ø)r|hundefôr|kattefôr|tørrfôr|fullfôr|solsikkefrø til fugl|villfuglblanding|dyref(o|ô|ó|ò|ö|ø)r|fuglefr(ø|oe)|hundegodt|hundesnack|tyggeben|dentastix|menybokser til katt')],
  ['Dyremat', word('whiskas|pedigree|royal ?canin|pussi|purina|felix|latz|sheba|eukanuba|frolic|chappi|vitakraft|dreamies')],
  ['Personlig pleie', stem('h(å|aa)rskum|h(å|aa)rspray|h(å|aa)r og kropp|bomullspads|bomullspinner|ansiktsrens|ansiktskrem|ansiktspleie|body lotion|body wash|badeskum|dusjkrem|intimvask|deo|negler|neglefil|tannpleie|tannpirker|tannb(ø|oe)rster|h(å|aa)rkur|h(å|aa)rb(ø|oe)rste|h(å|aa)rvoks|h(å|aa)rstyling|h(å|aa)rserum|concealer|foundation|eyeliner|makeup|make-up|bronzer|rouge|lipgloss|lip oil|lip balm|lipstick|selvbruning|fotkrem|h(å|aa)ndkrem|(ø|oe)yekrem|serum|micellar|tannblek|kroppskrem|natusan')],
  ['Personlig pleie', word('s(å|aa)pe|lano|dobbeldusch|sterilan|lypsyl|o\.b\.|depend|sol idox|solidox|sunsilk|veet|tangle teezer|scholl|cerave|cerave|neutrogena|neutral|vaseline|sensodyne|durex|rfsu|cosmica|locobase|eucerin|sebamed|deodorant|deoorant|deo|imse|bodylotion')],
  ['Husholdning', stem('br(ø|oe)dposer|glidel(å|aa)sposer|frysepose|avfallspose|oppvaskmiddel|flekkfjerner|flekkrens|kj(ø|oe)kkenpapir|t(ø|oe)rkepapir|husholdningspapir|mikro.?fiber.?klut|mikorfiber|skuresvamp|vaskesvamp|avl(ø|oe)ps(å|aa)pner|toalettrens|wc (block|gel)|wc-?(blokk|rens)|fresh discs|klesvask|vaskegel|vaskepulver|vaskekaps|gulvrens|plumbo|brillerens|st(ø|oe)vposer|gavepapir|matpakkepapir|kubbelys|kronelys')],
  ['Husholdning', word('vanish|torky|duck|sun oppvask|proff active|fresh discs|svamp|st(ø|oe)vpose|t(ø|oe)yserviett|poser')],
  ...LEGACY_RULES.filter(([c]) => CONSUMABLE_CATEGORIES.has(c) && c !== 'Barn & baby')
    .filter(([, re]) => !re.source.includes('kleshenger')),
];

const EXTRA_FOOD_RULES = [
  ['Ost', stem('skinkeost')],
  ['Husholdning', word('aluminiumsfolie')],
  ['Snacks & godteri', stem('sjokob(æ|ae)r|fruktkaramell|bisc(o|oo)ff|speculoos|proteinringer|caramels|caramel|candy|bubblegum|skulls|skaller|ritter sport|lotus biscoff|cheeky|choco|kinderegg|schokobons|fizzy|fruit dips|fun party mix|party ?mix|candypeople|pokemon fizz|spearmint|sweetmint|peach party|pergale|konfekt|taffel|wafer|love hearts|all sorts|36 mix|stjerne mix|matador mix|peely gummy|eucamenthol|ext\.prot|extraprotect|coop ufo|repsils')],
  ['Middag & ferdigmat', stem('pizza(?![a-zæøå])|falafel|satay kit|hot pot base|gyros|bacalaogryte|tom yum|middag|coop dagens|tex-mex|tikka masala|tofu|tempeh|quorn|b(ø|oe)nneburger|gr(ø|oe)nnsaksburger|proteinbowl|jeon-miks')],
  ['Pålegg', stem('postei|mortadella|skinke|salami|prosciutto|prociutto|d anskrull|danskrull|lammerull|honning|lerum klem|syltetøy|marmelade|peanut butter|pean(ø|oe)ttsm(ø|oe)r|peanutbutter')],
  ['Ost', stem('sveitserost|alpeost|tubeost|bl(å|aa)mugg|skinkeost|pepperost|krydderost|g(å|aa)rdsost')],
  ['Fisk & sjømat', stem('(ø|oe)rret|flyndre|ebi fry|gee-jang|salmon|shrimps?|crab|monkfish|cuttlefish')],
  ['Meieri & egg', stem('g(å|aa)rdsegg|gourmet butter|coffee[- ]?mate|coffee creamer|ayran|vita hjertego|youghurt|yog(h)?urt|proteinmelk|hap py farm')],
  ['Brød & bakeri', stem('gourmetstyk|myk ?& ?rund|pro kn(ä|æ)cke|ryvita|kardemommeskilling|bl(å|aa)b(æ|ae)rknute|kanelknute|crepes|gifflar|bakeren|papadum|roti')],
  ['Tørrvarer & baking', stem('arrowrotmel|melblanding|pizzamel|tortiglioni|rispapir|rummo|basmati|tempura batter|sirup|frøkn(e|æ)kk|urkorn|hvetekli')],
  ['Frukt & grønt', stem('granateple|k(å|aa)lrot|purre|rotmi(x|ks)|pomelo|nepe|kokebanan|oliven|paprika|koriander|drue|wokblanding|wokmiks|plantain|fries|fries|skviz')],
  ['Drikke', stem('kokosvann|sparkling|sprudle|sprudlande|snapple|mogu mogu|fruktdrikk|änglamark drikk|coop frii|skviz')],
  ['Kaffe & te', word('ali.+(filtermalt|kokmalt)|namaste')],
  ['Is & dessert', stem('tiramis(u|ù)|fl(ø|oe)teis|danette|dessert|panacotta|panna cotta')],

  ['Snacks & godteri', stem('chips|potetskruer|n(ø|oe)ttemiks|n(ø|oe)tteblanding|n(ø|oe)ttebar|be[- ]?kind|st\. michael peanuts|fleskesvor|kj(æ|ae)rlighet p(å|aa) pinne|melkerull|smil|troika|new energy|tyrkisk peber|sjoko popp|sjokopopp|royal pean(ø|oe)tt|swizzels|squashies|fruktpastiller|l(ä|æ)kerol|lakerol|skittles|sour rainbow|sour strawberry|salmiak|chupa chups|werther|japp|g ?& ?b juicy|refreshers|extra tyggis|geisha|fazer|cornitas|kr(ø|oe)nsj|minimix|halloween mix')],
  ['Kaffe & te', stem('cappuccino|triple ?shot|caff(e|è) latte|earl grey|matcha(?! jelly)|chai|fuz(e|é) tea')],
  ['Saus & krydder', stem('saus|krydder|majones|marinade|sause|hvitl(ø|oe)kpulver|sitronpepper|havsalt|saltflak|ketsjup|ketch.?up|eddik|epleedikk|sesamolje|chilipepper|seasoning|sauce|bean paste|sjamjang|ssamjang|currypaste|curry paste|tom yam|curry|jevn(er|ing)|oregano')],
  ['Ost', stem('g(å|aa)rdsost|magerost|tubeost|v(ä|æ)sterbotten|burrata|stracciatella|ep(o|oi)isses|selbu bl(å|aa)|kongsg(å|aa)rd|fl.temys|gudbrand|geitost|ekte geit|øst avind|østavind|ostepanetter')],
  ['Ost', word('tine (skivet|revet|økonomi revet)|synnøve revet|leerdammer|castello|cheese slices')],
  ['Meieri & egg', stem('melk|meierism(ø|oe)r|sm(ø|oe)remyk|sm(ø|oe)rbar|olivero|plantemargarin|yog(h|u|ur)*rt|danonino|litago|rislun(sj|js)|havrelunsj|havre lunsj|protein ?drikke')],
  ['Fisk & sjømat', stem('lakser(ø|oe)re|lakseburger|lof(o|ot)burger|spekesild|krabbeskjell|pangasius|steinbit|fish.{0,3}crisp|shrimp|kongereker|konger?eke|sea ?bass|fish')],
  ['Kjøtt & fjørfe', stem('burger|h(ø|oe)yrygg|bibringe|bog u|knoker?|m(ø|oe)rbrad|karbonad(er|e)|nakkekotelett|postei|strandam(ø|oe)r|blodpudding|lungemos|bratwurst|pekingand|storfekebab|andebryst')],
  ['Brød & bakeri', stem('kornstyk|havrestyk|fiberstyk|sesamstyk|surdeig|br(ø|oe)dskiv|bread|hverdagsgrovt|myk.{0,2}rund|myk og rund|vafler|klenning|flutes|miniflutes|m(ø|oe)llehjul|kakestykke|loria?na|padina|julius|josefines')],
  ['Brød & bakeri', word('cake|cakes|pancakes?|buns|terte|terter|rundrbød')],
  ['Tørrvarer & baking', stem('garofalo|fullkornpasta|fullkornslasagne|gr(ø|oe)tris|cruesli|solfrokost|rugspr(ø|oe)|leksand|krisproll|weetos|bens original|rice|flour|soyab(ø|oe)nn|baked beans|kidneyb(ø|oe)nner|paneringsmiks|bakemiks|corn starch|maisstivelse|maizena|lasagneplater')],
  ['Frukt & grønt', stem('gr(ø|oe)nnsak|potet|toma(tt|t)|b(ø|oe)nne|bringeb(æ|ae)r|skogsb(æ|ae)r|jordb(æ|ae)r|salatbar|salatmix|salatmiks|gulrot|buntl(ø|oe)k|salatl(ø|oe)k|r(ø|oe)dl(ø|oe)k|minir(ø|oe)sti|noisette|melon|babyspinat|urter|dragefrukt|daikon|rettich|edamame|durian|lotusrot|kantarell|r(ø|oe)sti|shine muscat|green peas')],
  ['Drikke', stem('saft|radler|faxe kondi|clausthaler|munkholm|schweppes|powerking|arctic water|jarritos|ginger lemon|ginger beer|stille vann|boble vann|zeroh|milky|fripa ipa|drikke|frisk bringebær')],
  ['Middag & ferdigmat', stem('pizzafyll|pizzalom|tomatsuppe|suppe|supper|rett i koppen|calzone|gnocchi|vegetar|samosa|mandu|ba[- ]jang|gimbap|ramyun|shin ram|corn dogs|billys|gorbys|margherita|l(ø|oe)vbiff|middags?[- ]?produkter|rask mat|mat i farta|topokki|sm(å|aa)rett|kimchi|seaweed rull|seaweed rice|vivera')],
  ['Is & dessert', stem('s(ø|oe)rlandsis|dessertis|royal (pinne|trippel)|ben.?&.?jerry|fl(ø|oe)tepudding|sjokopudding|cr(è|e)me br(û|u)l(e|é)e|fruktgele|jelly bean cake|mochi|sorbet|din stund')],

  ['Snacks & godteri', stem('ostepop|cheez doodles|ostestenger|ostest(a|æ)nger|cookies|brownies?|proteinbar|barebells|sn(æ|ae)kk|kr(ø|oe)nsj|godt & blandet|fisherman.?s friend|juicy drop|hazelnut wafers|maltesers|marshmallow|sjokolade|kjeks|micropopcorn|mikropopcorn|mikro.?popcorn|tortillachips|saltstenger|pean(ø|oe)tter')],
  ['Saus & krydder', stem('ostesaus|dressingmix|pesto|woksaus|sauser|pizzasaus|sweet chili|sweet & sour|sauce|sausemiks|fond|oksekraft|buljong|od elia|odelia|solsikkeolje|rapsolje|aioli|kikkoman|sambal|raita|passata|santa maria|chili explosion|hoisin|soyabean paste|sushieddik')],
  ['Middag & ferdigmat', stem('pizzaovn[- ]pizza|pizza for pizzaovn|lapskaus|dumpling|ramen|tacoskjell|macaroni.+cheese|mac.+cheese|kyllingretter|kyllingrett|matb(ø|oe)rsen|v(å|aa)rrull|tteokbokki|sushi|sushibit|ristorante|dr.? oetker|pinsa|b(ø|oe)rek|spring rolls|saritas|bibigo|ready meal|sam ?yang|snack ?pot|ready to|ferdigmat|gulasj|tortelloni|l(ø|oe)vstek|stroganoff')],
  ['Dyremat', word('pet food')],
  ['Pålegg', stem('g(å|aa)rdspostei|chicken&steak|servelat|kj(ø|oe)ttp(å|aa)legg|kalkunp(å|aa)legg|kyllingp(å|aa)legg|bogskinke|sm(å|aa)rettskinke|roastbiff|prosciutto|serrano|denja')],
  ['Ost', stem('cambozola|gorgonzola|taleggio|grana padano|parmigiano|gr(ä|æ)ddost|r(å|aa)bl(å|aa)|bl(å|aa)muggost|babybel|manchego|edamer|emmental|gouda|cheese')],
  ['Meieri & egg', stem('lettr(ø|oe)mme|soft flora|havredrikk|mandel.{0,5}soyadrikk|soyadrikk|mandeldrikk|plantemelk|alpro|oatly|actimel|arla protein|frokostegg|yogurt|yogurth|matyoghurt|pro.?pud|protein ?shake|protein ?pudding')],
  ['Fisk & sjømat', stem('fisk|filet av laks|lakseporsjon|laksebit|torske|sei(filet|loins)|l(ø|oe)ksild|lobnobs|monkfish|cuttlefish|salmon|shrimps|surimi|sardiner|ansjos|seabass|seabream|hummer|crab|haddock|scallop')],
  ['Kjøtt & fjørfe', stem('bacon|b(å|aa)con|biff|kylling|chicken|hot wings|kj(ø|oe)tt|lamme|lammek|lammes|reinskav|reinsdyr|elg|viltkj(ø|oe)tt|svine|sviner|pork|spareribs|steak|beef|korv|nuggets|kalkun|duck breast|andebryst|medister|lettsaltet sideflesk')],
  ['Brød & bakeri', stem('surdeig|rundstykk|familiebriks|morgenstykker|breakfast rolls|steam buns|pain au|paratha|giflar|kneipp|hatting|muffin|donuts?|pizzabunn|pizzadeig|naan|ciabatta|focaccia|briks|panini|scones|brioche|simit|sesambr(ø|oe)d')],
  ['Tørrvarer & baking', stem('fullkorn.{0,2}ris|jasminris|basmatiris|speltmel|spelt mel|maisenn?a|kellogg|havrefras|cheerios|havregryn|coco pops|corn cakes|rice cakes|cornflakes|coconut (cream|milk)|rice noodles|glassnud|nudler|tagliatelle|fettuccine|linguine|macaroni|maccheroni|tomaattimurska|hakkede toma|tomatb(ø|oe)nner|maiskorn|minimais|couscous|semule|tapioca|kokosmelk|kokosmasse|potetmel|maismel|rismel|panko|breadcrumbs|griljermel')],
  ['Frukt & grønt', stem('brekkb(ø|oe)nne|wokmix|asparges|bambusskudd|vannkastanj|sellerirot|stangselleri|pastinakk|kinak(å|aa)l|pakchoi|pak choy|pak choi|snackgulrot|minigulrot|v(å|aa)rl(ø|oe)k|v(å|aa)rk(å|aa)l|selskaps?erter|nypotet|potetstaver|potetstappe|potetmos|opph(ø|oe)gde pot|s(ø|oe)tpotet|nektarin|fersken|spisspaprika|gresskar|mais|r(ø|oe)dbet|meksikansk mix|salatmix|rosin|dadler|valn(ø|oe)tt|hasseln(ø|oe)tt|pasjonsfrukt|tytteb(æ|ae)r|artisjokk|rabarbra')],
  ['Frukt & grønt', word('kiwi|klementin|avocado|b(æ|ae)r|chili|picks banan|brekkb(ø|oe)nner|dill|rosmarin|timian|t(ø|oe)rkede aprikoser')],
  ['Drikke', stem('husholdningssaft|appelsinbrus|traneb(æ|ae)rjuice|fun light|capri[- ]?sun|froosh|mad-croc|san pellegrino|solan de cabras|stille vann|lemonade|saftsuse|ultrapop|pouch drikke|vitamin well|arizona|calypso|ramune|kombucha|ice tea|iste|iced tea|juice|brus|smoothie|ingef(æ|ae)rshot|popping boba|ginger beer')],
  ['Is & dessert', word('kos|go.?vegan is|alpro dessert')],
  ...LEGACY_RULES.filter(([c]) => FOOD_CATEGORIES.has(c)),
  ['Snacks & godteri', word('cloetta|lutti|tupla|car toonies|cartoonies|ahlgrens|bryn(h|i)ild|dent|mentos|haribo|mars|m&m.?s|lion|hobby|kick|kettle|gå nuts')],
];

const NONFOOD_RULES = [
  ...EQUIPMENT_RULES,
  ...LEGACY_RULES.filter(([c]) => !FOOD_CATEGORIES.has(c) && !CONSUMABLE_CATEGORIES.has(c) && c !== 'Dyr'),
  ['Apotek & helse', stem('kreatin|creatine|biopharma|melatonin|vitaminbj(ø|oe)rn|vitaminer|vitamin[- ]?[abcd]|gummies|tran(?![a-zæøå])|omega[- ]?3|collagen|kollagen|magnesium|sinktilskudd|jerntilskudd|vitamin.+tilskudd|melkesyrebakterier|blodtrykk|kompresjon|st(ø|oe)ttestr(ø|oe)mpe|urinlekkasje|inkontinens')],
];
const SPECIFIC_RULES = [
  ['Bil & motor', word('exide')],
  ['Belysning', stem('gresskar led')],
  ['Møbler & interiør', stem('m(ø|oe)bler')],
  // These heads disambiguate broad material/ingredient matches below.
  ['Leker & spill', stem('traktor med tilhenger|rc magic flying ball|kortspill')],
  ['Belysning', stem('diskolys|lysspeil')],
  ['Møbler & interiør', stem('sittebenk|recliner|fuskepelsteppe|midtmodul|lyslykt')],
  ['Møbler & interiør', word('pall')],
  ['Hjem & oppbevaring', stem('oppvaskkost|rengj(ø|oe)ringsb(ø|oe)rste|sminkereisebag|skuffereol')],
  ['Elektronikk', stem('fonduesett|lydplanke|kamerakit|cepter')],
  ['Smarthus & sikkerhet', stem('waterguard|watersensor|vannlekkasjesensor')],
  ['Bil & motor', stem('carplay|polar blast')],
  ['Bygg & jernvare', stem('demoleringshammer|multiblokk|marmor(?!kake)|hylle gran')],
  ['Sport & fritid', stem('m(ø|oe)belstruktur|kardet ull|syskrin|beltespenne|trykkfotsett|sitteunderlag')],
  ['Klær & sko', stem('ullbukse|ulldress')],
  ['Kjøkken & servering', stem('dessertsk(å|aa)l|sprayflaske til olje|pizzakutter|t(ø|oe)yserviett|bolle.{0,10}(ø|cm|[0-9])')],
  ['Hage & uterom', stem('gresstrimmer|tennposer|opptennings|tennbrikett')],
  ['Personlig pleie', stem('barberh(ø|oe)vel|h(å|aa)rb(ø|oe)rste|bomullspinn|bomullspad|smilelab|korres|lumene|munnhygiene')],
  ['Husholdning', stem('kafferensemiddel|gryteskrubb')],
  ['Barn & baby', stem('skumpinner|barnemat|barnegr(ø|oe)t')],
  ['Dyremat', stem('fuglepean(ø|oe)tt|friskies')],
  ['Dyremat', /^h(ø|oe)y$/i],
];

// Product families precede flavour/ingredient words in variant listings.
const VARIANT_FAMILY_RULES = [
  ['Snacks & godteri', word('pringles')],
  ['Drikke', word('urge|coca[- ]cola|fanta|farris(?: frus)?')],
  ['Frysevarer', word('findus wok')],
];
const FOOD_HEAD_RULES = [
  ...VARIANT_FAMILY_RULES,
  ['Middag & ferdigmat', stem('(fiske|kj(ø|oe)tt|beta|tomat|gr(ø|oe)nnsak|kylling)?suppe')],
  ['Saus & krydder', word('tzatziki|miso')],
  ['Pålegg', stem('mandelsm(ø|oe)r')],
  ['Frukt & grønt', stem('l(ø|oe)kpose')],
  ['Brød & bakeri', stem('baguette|ciabatta')],
  ['Meieri & egg', stem('sjokolademelk|sjokomelk')],
  ['Pålegg', stem('postei|kokt skinke|serranoskinke|lammerull')],
  ['Pålegg', word('skinke')],
  ['Fisk & sjømat', stem('fiskeboller|fish taco')],
  ['Tørrvarer & baking', stem('nudler|basmatiris')],

  ['Snacks & godteri', stem('potetgull|sjokolade|kjeks|safari original|pean(ø|oe)tter|cashew|n(ø|oe)ttemiks')],
  ['Snacks & godteri', word('polly')],
  ['Middag & ferdigmat', stem('fjordland|real turmat|namaste|vegetar|fiskegrateng|fiskesuppe|kyllingretter|kyllingrett')],
  ['Middag & ferdigmat', word('pizza|lasagne|taco|suppe')],
  ['Middag & ferdigmat', stem('steinovnspizza|snackpizza')],
  ['Saus & krydder', stem('pizzasaus|pastasaus|tacokrydder|tomatpur(e|é)')],
  ['Pålegg', stem('majones|hamburgerrygg')],
  ['Is & dessert', stem('jelly bean cake')],
  ['Meieri & egg', stem('olivero')],
  ['Tørrvarer & baking', stem('risnudler|maiskaker|hakkede toma|tomaattimurska')],
  ['Tørrvarer & baking', word('maiskorn|mais')],
  ['Brød & bakeri', stem('baguette|tortilla(?! ?chips)|lomper|rundstyk|knekkebr(ø|oe)d')],
  ['Fisk & sjømat', stem('hysekake|makrell|laks|fiskeburger')],
  ['Kjøtt & fjørfe', stem('grillp(ø|oe)lse|wienerp(ø|oe)lse|kj(ø|oe)tt|den stolte hane')],
  ['Kjøtt & fjørfe', word('and')],
  ['Frysevarer', stem('findus perfekt til fisk')],
];
// Explicit product nouns distinguish independent products from flavour-only tails.
const LIST_PRODUCT_HEAD_RULES = [
  ['Kaffe & te', word('kaffe|te')],
  ['Drikke', word('brus|juice|saft')],
  ['Snacks & godteri', stem('sjokolade|chips|kjeks|potetgull')],
  ['Meieri & egg', word('melk|egg|smør')],
  ['Fisk & sjømat', word('laks|torsk|fisk')],
];
// Specific food heads precede ingredients; loose produce terms are last.
const FOOD_ORDER = ['Snacks & godteri', 'Saus & krydder', 'Middag & ferdigmat',
  'Is & dessert', 'Tørrvarer & baking', 'Brød & bakeri', 'Ost', 'Meieri & egg',
  'Fisk & sjømat', 'Kjøtt & fjørfe', 'Pålegg', 'Kaffe & te', 'Drikke', 'Frukt & grønt', 'Frysevarer'];
const RULES = [...NON_GROCERY_HEAD_RULES, ...SPECIFIC_RULES, ...NONFOOD_RULES, ...CONSUMABLE_RULES,
  ...FOOD_HEAD_RULES, ...[...EXTRA_FOOD_RULES].sort(([a], [b]) => FOOD_ORDER.indexOf(a) - FOOD_ORDER.indexOf(b))];
export const CATEGORIES = [...new Set(RULES.map(([c]) => c)), 'Annet'];
export const DEPARTMENTS = [
  'Dagligvarer', 'Hjem & interiør', 'Bygg, hage & bil', 'Elektronikk',
  'Fritid, klær & leker', 'Helse & apotek', 'Annet',
];

const DEPARTMENT_CATEGORIES = {
  'Dagligvarer': [...FOOD_CATEGORIES, ...CONSUMABLE_CATEGORIES],
  'Hjem & interiør': ['Møbler & interiør', 'Kjøkken & servering', 'Belysning', 'Blomster & planter', 'Hjem & oppbevaring'],
  'Bygg, hage & bil': ['Bygg & jernvare', 'Oppvarming', 'Hage & uterom', 'Bil & motor'],
  'Elektronikk': ['Elektronikk', 'Smarthus & sikkerhet'],
  'Fritid, klær & leker': ['Sport & fritid', 'Klær & sko', 'Leker & spill', 'Dyreutstyr'],
  'Helse & apotek': ['Apotek & helse'],
};
const CATEGORY_DEPARTMENT = new Map(Object.entries(DEPARTMENT_CATEGORIES)
  .flatMap(([department, categories]) => categories.map(category => [category, department])));
export function departmentOf(category) {
  return CATEGORY_DEPARTMENT.get(category) ?? 'Annet';
}

function groceryCapable(category, chainSectors) {
  return chainSectors.some(sector =>
    sector === 'Dagligvarer' || sector === 'Lavpris & variert' ||
    (sector === 'Helse & skjønnhet' && ['Personlig pleie', 'Barn & baby'].includes(category)) ||
    (sector === 'Hage & dyr' && category === 'Dyremat'));
}

function match(text, chainSectors, rules = RULES) {
  if (!text) return null;
  for (const [category, re] of rules) {
    // The whole department is guarded; unknown sectors never enable groceries.
    if (departmentOf(category) === 'Dagligvarer' && !groceryCapable(category, chainSectors)) continue;
    if (re.test(text)) return category;
  }
  return null;
}

/** Name first, descriptions only for unrecognised names; sector never sets department. */
export function classifyProduct({ name, descriptions = '', chainSectors = [] } = {}) {
  // Packaging and incidental oven/fireplace wording do not change food identity.
  const foodName = String(name ?? '').replace(/pizzaovn[- ]pizza|pizza for pizzaovn/gi, 'pizza')
    .replace(/peis[- ]kos(?=\s+sjokolade)/gi, 'kos')
    .replace(/(?<![a-zæøå])(?:i|p(å|aa)) glass(?![a-zæøå])/gi, '');
  const description = Array.isArray(descriptions) ? descriptions.filter(Boolean).join(' ') : descriptions;
  // A comma/"og" can introduce either another product or a flavour variant.
  // Branded product families own loose ingredient matches, but cannot swallow
  // another recognisable product head ("Fanta, Pringles" or "Farris, telysholder").
  const parts = foodName.split(/,(?![0-9])|(?<!-)\s+og\s+/i).map(part => part.trim());
  const family = match(parts[0], chainSectors, VARIANT_FAMILY_RULES);
  const equipmentHead = match(parts[0], chainSectors, NON_GROCERY_HEAD_RULES);
  // An equipment head owns its "med frukt og ..." description, too.
  const categories = equipmentHead && !foodName.includes(',') ? [equipmentHead] : parts.map(part => {
    const category = match(part, chainSectors);
    if (!family || !category || departmentOf(category) !== 'Dagligvarer') return category;
    const explicitHead = match(part, chainSectors, FOOD_HEAD_RULES) ??
      match(part, chainSectors, LIST_PRODUCT_HEAD_RULES);
    return explicitHead ?? family;
  }).filter(Boolean);
  if (new Set(categories).size > 1) return { category: 'Annet', department: 'Annet' };
  const category = match(foodName, chainSectors) ?? match(description, chainSectors) ?? 'Annet';
  return { category, department: departmentOf(category) };
}

/** Legacy text-only callers have no retailer context; department calls require it. */
export function categorize(name, description = '') {
  return classifyProduct({ name, descriptions: description, chainSectors: ['Dagligvarer'] }).category;
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
  'Kids Outlet': 'Leker & barn',
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
