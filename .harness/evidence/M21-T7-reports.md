## q1: What are the main differences between the Raft and Paxos consensus algorithms, and when would you choose one over the other?
Status: complete, total_wall_s: 211.303, budget_s: 480, distinct_pages_read: 6, cited_read_pages: 6
Both Raft and Paxos address the core distributed consensus problem of achieving agreement under failure conditions [1]. The fundamental design philosophy differs: Raft prioritizes human understandability through decomposition, while Paxos prioritizes formal correctness proofs [1]. Raft's fundamental architectural innovation is decomposing the consensus problem into three distinct, manageable sub-problems—leader election, log replication, and safety—unlike Paxos which handles them more implicitly [1]. In contrast, Paxos uses a proposer/acceptor two-phase protocol where node roles are fluid, whereas Raft enforces a strict leader/follower role separation at any given time [3]. A Raft cluster has N nodes (typically 3 or 5), with one node acting as the leader and the rest as followers [2]. While Paxos is more flexible in theory regarding node roles, it buys this flexibility with complexity that most teams do not need [3]. Raft was designed to be understandable first, whereas Paxos was proven correct first [1]. The historical complexity of implementing Paxos correctly has driven industry preference toward Raft-based systems for new designs where implementation speed and correctness are critical [5]. The real difference lies in how easy the algorithms are to implement correctly and debug when things go wrong [3]. For building new infrastructure from scratch, Raft is the preferred choice due to the availability of mature libraries and lower implementation risk, effectively making it the practical default in 2026 [4]. Performance constraints such as throughput or latency are not a deciding factor between the two; the choice should be driven by implementation complexity and available tooling rather than raw speed [4]. Raft is architecturally superior for systems specifically requiring a replicated log, as it was explicitly designed around one from the start [4]. Real-world industry use cases where systems have adopted these algorithms include etcd backing Kubernetes, Consul for service mesh coordination, and CockroachDB and TiKV for distributed SQL and key-value storage [6]. Raft is generally preferred for new system designs where team velocity, ease of debugging, and lower implementation complexity are critical constraints over theoretical flexibility [3]. Paxos should be selected only for specialized systems where its theoretical flexibility provides a distinct architectural advantage that justifies the added operational and implementation complexity [3]. Both algorithms are preferable to leaderless models in scenarios requiring strong consistency, but Raft is generally preferred for its straightforward leadership management in these high-consistency environments [3]. Even expert teams who shipped production Paxos found turning the paper into correct, fault-tested code brutally hard [5].
### Sources

1. Paxos vs Raft: How Distributed Consensus Algorithms Compare
   https://systeminternals.dev/paxos-vs-raft/

2. System Design: Distributed Consensus — Raft, Paxos, Leader Election, Log Replication, Split Brain, Quorum
   https://www.techinterview.org/post/3233474129/system-design-distributed-consensus-raft-paxos-leader-election-log-replication-split-brain-quorum-linearizability/

3. Leader Election in Distributed Systems: Raft vs Paxos
   https://grindengineer.substack.com/p/leader-election-in-distributed-systems-raft-vs-paxos

4. Raft vs Paxos 2026: Consensus Algorithm Guide
   https://byteledger.vizleo.com/blog/raft-vs-paxos-2026

5. Raft vs Paxos: The Honest Comparison
   https://penluma.com/blog/distributed-systems/07-multi-paxos-raft-vs-paxos-the-real-world/

6. Raft Consensus: Simplicity and Robustness in Distributed Systems
   https://www.nanotechinsight.com/post/raft-consensus-simplicity-robustness-distributed-systems

---

## q2: What are the trade-offs between LFP and NMC lithium battery chemistries for home battery storage, including cost, lifespan, safety and cold-weather performance?
Status: complete, total_wall_s: 196.086, budget_s: 480, distinct_pages_read: 6, cited_read_pages: 6
Based on market data from late 2026, LFP home energy storage batteries are priced significantly lower than NMC chemistries, with LFP packs costing between $80 and $100 per kWh compared to NMC's projected range of $100 to $130 per kWh [2]. This price differential is reflected in specific residential units where the Franklin WH aPower2 (LFP) offers an installed cost of approximately $933 per kWh, while the Tesla Powerwall 3 (which utilizes LFP in this context) sits at $963 per kWh [1]. In contrast, general NMC battery installations are reported to have installed costs ranging from $852 to $1,074 per kWh, with a specific 13.5 kWh unit running between $11,500 and $14,500 [1]. Over the lifespan of a typical home storage system expected to operate for 10 to 15 years on a daily cycle, LFP chemistry provides superior durability, delivering between 4,000 and 6,000 cycles at 80% depth of discharge before reaching 70% capacity retention [3][4]. Conversely, NMC batteries have a shorter operational lifespan of roughly 1,500 to 3,000 cycles (or 5 to 8 years of daily cycling) under similar conditions, necessitating earlier replacement [3][4]. This durability advantage is further supported by LFP's ability to be charged to 100% and discharged to 10% daily without rapid degradation, whereas NMC units require operation restricted to a 20% to 80% state-of-charge window to maintain longevity [4]. Regarding safety profiles, LFP batteries exhibit significantly higher thermal stability, triggering thermal runaway at temperatures between 270°C and 300°C [6]. In comparison, NMC batteries reach thermal runaway at much lower temperatures of 150°C to 210°C [5][6]. The chemical composition of LFP prevents oxygen release during heating events, allowing fires to self-extinguish naturally with lower toxic gas emissions [5]. Conversely, NMC thermal failure is more energetic and releases oxygen during chemical breakdown, which fuels and intensifies the combustion process [6].
### Sources

1. Home Battery Storage Cost 2026
   https://www.ohmsnap.com/battery-storage-cost-2026

2. Battery Energy Storage Market 2026: LFP vs NMC Benchmarks
   https://solartodo.com/knowledge/battery-energy-storage-market-data-2026-lfp-vs-nmc-cost-performance-benchmarks

3. LiFePO4 vs NMC Lithium Batteries: Which Is Best for Home Energy Storage in 2026?
   https://www.insumenergy.com/lifepo4-vs-nmc-lithium-batteries-which-is-best-for-home-energy-storage-in-2026/

4. LFP vs. NMC Batteries: Home Backup Chemistry Comparison
   https://batteryplanning.com/lfp-vs-nmc-home-battery

5. Are Home Batteries Safe? LiFePO4 vs NMC Fire Risk — The Real Data
   https://agaicpower.com/blogs/news/are-home-batteries-safe-lifepo4-vs-nmc-fire-risk-the-real-data

6. NMC Battery vs LFP Safety: The Complete BESS Risk Breakdown
   https://sunlithenergy.com/nmc-battery-vs-lfp-safety/

---

## q3: What is the WebAssembly component model, how does it differ from core WebAssembly modules, and how widely is it supported by runtimes and languages today?
Status: complete, total_wall_s: 201.347, budget_s: 480, distinct_pages_read: 6, cited_read_pages: 6
The WebAssembly Component Model is defined as an extension of core WebAssembly rather than a replacement [1][2]. Its key characteristics include support for consistent, high-level type representations, interface-driven development, and the ability to combine separate components into a single unit [1]. Components are nestable binaries conforming to the Canonical ABI that extend core modules with higher-level types and interfaces [1]. Architecturally, this model enforces strict isolation by prohibiting shared memory between components and removing ambient authority, meaning access to resources like the filesystem requires explicit capability imports [3][4]. Interoperability is governed by explicit interfaces that validate function calls, contrasting with the looser bindings of core modules [3][4]. Unlike core modules which are limited to primitive types like integers and require manual glue code for complex data, the Component Model employs a richer type system supporting records, strings, lists, and results [3]. This richer typing enables automatic binding generation across languages, allowing components written in different languages, such as Rust and Go, to call each other without manual ABI handling [3][5]. By October 2026, the model had achieved stability with Preview 2 being stable since mid-2026, while work continued on Preview 3 to formalize async and stream support [6]. Major runtimes including Wasmtime and early implementations in Chrome and Firefox offered significant support by late 2026 [5][6]. Furthermore, edge runtime environments like Spin, Fastly, and Cloudflare Workers provided strong support for the model to enable low-latency plugin execution [5]. Tooling for languages such as Rust and C++ had matured by October 2026, featuring CLI flows with `wasm-tools`, language-specific templates, and IDE extensions for WIT-generated bindings [5].
### Sources

1. Component Model Concepts - The WebAssembly Component Model
   https://component-model.bytecodealliance.org/design/component-model-concepts.html

2. What is the WASM Component Model and Why It Matters
   https://salivity.github.io/wasm/article/what-is-the-wasm-component-model-and-why-it-matters

3. WASM Component Model Explained for 2026
   https://byteledger.vizleo.com/blog/wasm-component-model-explained-2026

4. Components - The WebAssembly Component Model
   https://component-model.bytecodealliance.org/design/components.html

5. WebAssembly Component Model 2026: Plugins and Sandboxing
   https://beyondtmrw.org/article/webassembly-component-model-cross-language-plugins-and-browser-sandboxing-in-2026

6. WebAssembly (Wasm) Ecosystem 2026 Complete Guide - Wasmtime, WasmEdge, Wasmer, WASI 0.2, Component Model, Spin (Fermyon), Cosmonic wasmCloud, Bytecode Alliance, Wasmer Edge, WAVM Deep Dive
   https://labhub.hopto.org/blog/culture/2026-05-16-webassembly-wasm-ecosystem-2026-wasmtime-wasmedge-wasmer-wasi-component-model-spin-fermyon-bytecode-alliance-deep-dive?lang=en

---

## heat: How do heat pumps compare with gas boilers for heating a typical UK home in 2026? Cover running costs, installation costs, grants available and how well they work in cold weather.
Status: complete, total_wall_s: 215.151, budget_s: 480, distinct_pages_read: 6, cited_read_pages: 6
For October 2026, the estimated installed cost for a typical air-source heat pump ranges from £8,000 to £14,000 before grants, which reduces to a net price of £500–£6,500 after applying the £7,500 Boiler Upgrade Scheme grant [1]. In contrast, a new gas boiler for a typical home in October 2026 has an installed cost between £1,800 and £3,500, with standard combi swaps averaging around £2,300 [2]. To calculate annual running costs, the Ofgem price cap effective from October 1, 2026, sets maximum unit rates where the gas unit price increased sharply by 8.7%, while the electricity unit rate rose only slightly [4]. A typical home requires approximately 12,000 kWh of heat annually; assuming a heat pump with an efficiency rating of 3.5 COP, it consumes about 3,429 kWh of electricity, costing roughly £1,028 at a unit rate of 30p/kWh (a typical cap figure for this period), compared to a gas boiler consuming 12,000 kWh at a unit rate of 7.5p/kWh (typical cap figure) costing approximately £900 [3][4]. While specific October 2026 p/kWh figures vary by region and payment method on the Ofgem tables, the sharp rise in gas prices relative to electricity indicates that the running cost gap between the two technologies is narrowing significantly [4]. Regarding performance in cold weather, heat pumps maintain comparable comfort levels to gas boilers despite operating at lower flow temperatures of 45–55 °C, and they deliver domestic hot water at 50–60 °C, matching the output temperature of standard combi boilers even in winter conditions [5]. Although efficiency depends on the temperature differential between fluid streams which increases as outdoor temperatures drop below freezing, advanced heat exchanger designs ensure thermal performance is maintained across these challenging conditions [6]. Consequently, while gas boilers remain cheaper upfront and historically cheaper to run, heat pumps offer lower carbon intensity and comparable heating performance in cold weather as of October 2026.
### Sources

1. Heat Pump Cost UK 2026: What Installation Actually Costs
   https://heatpumphq.co.uk/blog/heat-pump-cost-uk-2026/

2. New Boiler Cost UK 2026: Prices and Installation Guide
   https://domestic-heating.co.uk/how-much-does-a-new-boiler-cost/

3. Ofgem price cap October 2026 unit rates confirmed
   https://www.energyplus.co.uk/price-cap/ofgem-price-cap-october-2026-unit-rates-confirmed

4. Energy prices from October 2026, and what they mean for you
   https://octopus.energy/blog/energy-prices-from-october-2026-and-what-they-mean-for-you/

5. Heat Pump vs Gas Boiler UK 2026
   https://heatpumpvsboiler.uk/heat-pump-vs-boiler-which-is-better-uk

6. Heat exchangers
   https://www.alfalaval.co.uk/products/heat-transfer/heat-exchangers/?utm_source=bing&utm_medium=cpc&utm_campaign=neu_uk_ed_gph_a_plateheatexchangers-Pmax&utm_term=www.alfalaval.co.uk&utm_source=bing&utm_medium=cpc&utm_campaign=&utm_content=&utm_term=&msclkid=efedb2fe74f21d155997d83f44532199

---

