## q1: What are the main differences between the Raft and Paxos consensus algorithms, and when would you choose one over the other?

Status: complete, total_wall_s: 239.569, budget_s: 480, distinct_pages_read: 5, cited_read_pages: 4

Raft and Paxos differ fundamentally in their architectural models for leader election and log replication. Raft relies on a dedicated leader elected via randomized timeouts, whereas standard Paxos utilizes a flexible proposer/acceptor model without a permanent leader [1]. The architectural foundation of standard Paxos is decentralized proposal capability, contrasting with Raft's centralized leadership model where any node can act as a proposer at any time [1]. Regarding state machine safety, Raft ensures correctness by rejecting AppendEntries requests if the follower's log does not match the leader's at the specified index [2]. Operationally, Raft achieves simplicity by restricting the system model to a strong leader and a single log, thereby reducing the number of states developers must reason about [3]. This focus on readability provides a primary operational advantage over Paxos, as it reduces the risk of implementation bugs that could corrupt data [3]. Despite these differences in complexity, Raft and Multi-Paxos provide identical fault tolerance guarantees and performance metrics at the algorithmic level [3]. Documented use cases indicate that pure Paxos is rarely implemented in production because the original algorithm is a mathematical proof rather than a blueprint for code [5]. Instead, existing systems like Google's Chubby and ZooKeeper's Zab utilize heavily modified variants of Paxos [5]. Consequently, Raft is the recommended default choice for new production systems due to its superior debuggability and maintainability [5]. Standard practice suggests choosing Raft unless there is a specific reason such as existing infrastructure requirements [5]. Paxos should only be selected for new implementations when forced by legacy infrastructure constraints or integration needs [5]. In summary, while both algorithms offer equivalent safety and speed, Raft's explicit leadership model makes it preferable for new systems where readability and implementation ease are prioritized [3].

### Sources

1. Leader Election in Distributed Systems: Raft vs Paxos
   https://grindengineer.substack.com/p/leader-election-in-distributed-systems-raft-vs-paxos

2. Paxos vs Raft: How Distributed Consensus Algorithms Compare
   https://systeminternals.dev/paxos-vs-raft/

3. Raft vs Paxos: The Honest Comparison
   https://penluma.com/blog/distributed-systems/07-multi-paxos-raft-vs-paxos-the-real-world/

4. Paxos vs. Raft Algorithm in Distributed Systems
   https://www.geeksforgeeks.org/system-design/paxos-vs-raft-algorithm-in-distributed-systems/

5. Distributed Consensus: Paxos vs Raft – Which One Won't Fail
   https://thecodeforge.io/system-design/consensus-paxos-raft/

---

## q2: What are the trade-offs between LFP and NMC lithium battery chemistries for home battery storage, including cost, lifespan, safety and cold-weather performance?

Status: complete, total_wall_s: 173.522, budget_s: 480, distinct_pages_read: 4, cited_read_pages: 2

For home energy storage, LFP batteries currently offer a lower cost per kilowatt-hour (kWh) compared to NMC chemistries, with BYD offering rates between €500 and €700 per kWh [1]. While specific total system costs are not detailed in the provided notes, the unit price advantage indicates that an LFP system will have a lower initial investment than an equivalent NMC system. Regarding lifespan, LFP batteries exhibit minimal degradation and can potentially last the full 15-year lifespan of a home energy storage system [3]. In contrast, the notes do not provide specific cycle life or degradation figures for NMC batteries to allow a direct quantitative comparison of their total lifespan under typical usage patterns. Safety profiles differ significantly between the two chemistries; LFP batteries demonstrate superior thermal stability, whereas NMC batteries have a lower thermal runaway threshold around 210°C, indicating a higher potential fire risk [4]. Finally, the provided notes do not contain data regarding the differences in cold-weather capacity retention between LFP and NMC chemistries.

### Sources

1. Tesla Powerwall vs BYD vs Sonnen 2026: Battery Comparison
   https://www.surgepv.com/blog/tesla-powerwall-vs-byd-vs-sonnen

2. LFP vs NMC Battery Cost Comparison 2026: Cycle Life,…
   https://solartodo.com/knowledge/lfp-vs-nmc-battery-cost-comparison-2026-cycle-life-safety-tco-data

3. EV Battery Degradation: NMC vs LFP Lifespan Data Analysis
   https://autoedgeview.com/battery-guides/nmc-vs-lfp-ev-battery-degradation-data

4. Are Home Batteries Safe? LiFePO4 vs NMC Fire Risk — The Real Data
   https://agaicpower.com/blogs/news/are-home-batteries-safe-lifepo4-vs-nmc-fire-risk-the-real-data

---

## q3: What is the WebAssembly component model, how does it differ from core WebAssembly modules, and how widely is it supported by runtimes and languages today?

Status: complete, total_wall_s: 205.117, budget_s: 480, distinct_pages_read: 6, cited_read_pages: 3

The WebAssembly Component Model is formally defined as a framework enabling multiple WebAssembly modules, potentially written in different programming languages, to compose together through rich, typed interfaces [4]. Structurally, it differs from core WebAssembly by introducing the WIT (WebAssembly Interface Types) type system, which supports complex data types such as strings, lists, records, variants, and enums [4]. Unlike core modules that lack a formal interface definition layer, Components rely on the WIT specification to declare types and interfaces, typically defined in `wit` files within a `wit` directory [3]. Functionally, core WebAssembly is restricted to importing and exporting functions that accept and return only numeric types like integers and floats [4]. In contrast, Core modules limit data exchange to basic primitive types, requiring manual memory management for complex data like strings, whereas the Component Model automatically generates serialization code to bridge different languages' memory models [4]. As of October 2026, support for the WebAssembly Component Model is available across major programming languages including C/C++, C#, Go, JavaScript, Python, Rust, MoonBit, and WAT [5]. Major runtimes support this model by relying on 'world' definitions rather than language-specific binary formats, ensuring portability across different host environments [5].

### Sources

1. WebAssembly Core Specification
   https://www.w3.org/TR/wasm-core-1/

2. WebAssembly Core Specification
   https://www.w3.org/TR/wasm-core-2/

3. Forays into the Wasm Component Model
   https://moalyousef.github.io/blog/WasmCompModel.html

4. WebAssembly Component Model: Composing Wasm Modules
   https://minhvo.is-a.dev/blogs/webassembly-component-model-composing-wasm-modules

5. Creating Components - The WebAssembly Component Model
   https://component-model.bytecodealliance.org/language-support

6. Language Support for WebAssembly Components
   https://wasmcloud.com/docs/wash/developer-guide/language-support/

---

## heat: How do heat pumps compare with gas boilers for heating a typical UK home in 2026? Cover running costs, installation costs, grants available and how well they work in cold weather.

Status: complete, total_wall_s: 220.239, budget_s: 480, distinct_pages_read: 6, cited_read_pages: 5

### Total Installed Costs and Grants
As of October 3, 2026, the government grants under the Boiler Upgrade Scheme provide significant but partial financial support for heating installations. For a typical air-to-water heat pump in a property not on the gas grid, the grant value is £7,500 [1]. If the property is an off-gas grid replacement of a liquefied petroleum gas system with high-efficiency requirements, the grant increases to £9,000 [1]. Ground source heat pumps also receive a grant value of £7,500 for eligible off-gas properties [1], whereas air-to-air heat pumps in typical homes receive a lower grant of £2,500 [1]. These grant categories became effective from July 21, 2026, and the scheme remains active under the 2022 regulatory framework in October 2026 [1]. While homeowners can access upfront vouchers for eligible low-carbon heating, it is explicitly not a free-boiler scheme, meaning households must pay the remaining balance after the voucher deduction [2]. Consequently, while specific gas boiler installation costs are not detailed in the provided notes, heat pump installations require an initial outlay that is reduced by these grant amounts but remains substantial due to the uncovered portion of the total cost.

### Running Costs and Energy Prices
For October 2026, the average unit price for natural gas is 7.97p per kWh for Direct Debit customers, subject to the price cap effective from October 1, 2026 [3]. This gas price varies slightly by region, ranging from 7.82p in the East Midlands to 8.17p in Southern England [3]. Electricity costs approximately three times more per kilowatt-hour than natural gas during this period [3]. To match the running costs of a gas boiler under these conditions, a heat pump must achieve a coefficient of performance (COP) of at least 3 [3]. The specific annual running costs in pounds for a typical home cannot be calculated precisely without a stated quantity of energy consumption (kWh) for a typical year, as the notes provide unit prices but no consumption figures; however, the relative cost comparison indicates that gas heating is currently cheaper to run than direct electric heating or heat pumping unless the specific efficiency threshold is met [3].

### Performance During Cold Weather
Regarding thermal performance in typical UK winter conditions, air-source heat pumps maintain operational functionality and heating output even when temperatures drop well below freezing. Modern cold-climate heat pumps can operate effectively at temperatures as low as minus 15°C to minus 25°C depending on the specific model [5]. Although the efficiency advantage of heat pumps decreases as outdoor temperatures drop, they consistently outperform gas boilers across all tested cold weather scenarios, with the performance gap narrowing but never reversing [6]. Properly sized modern units are designed to sustain high heat output levels during sub-zero temperatures typical of UK winters, ensuring radiators remain warm even when the outside air is freezing [5]. These conditions reflect the typical UK winter environment where temperatures rarely drop below -3°C [5].

### Sources

1. Notice of approved grant categories and values for the Boiler Upgrade Scheme
   https://www.gov.uk/government/publications/boiler-upgrade-scheme-regulations-approved-standards-grant-categories-and-grant-levels/notice-of-approved-grant-categories-and-values-for-the-boiler-upgrade-scheme

2. Boiler Upgrade Scheme 2026: Current Voucher Rules
   https://warmhomeuk.co.uk/grants/boiler-upgrade/

3. UK Utility Compliance & Procurement
   https://britishenergycompliance.co.uk/gas-unit-rate/

4. Electricity Cost per Unit UK 2026 – Q3 & Q4 Ofgem Rates
   https://electricitycostcalc.com/electricity-cost-per-unit-uk.html

5. Do Heat Pumps Work in Winter? UK Cold Weather Guide 2026
   https://www.energysavinghub.co.uk/do-heat-pumps-work-in-winter/

6. Do Heat Pumps Work in UK Winter? 2026 Cold Weather Perfor...
   https://www.heatpumpcompared.co.uk/blog/heat-pumps-uk-winter-2026-cold-weather-performance

---

