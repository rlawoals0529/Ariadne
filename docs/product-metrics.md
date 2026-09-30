# Product metrics and scan analytics

Ariadne v1.0 adds product-style analytics without adding behavioral tracking. Every metric in the interface is derived from the current scan results in the browser. Ariadne still stores no usernames, searches, friend groups, or analytics events.

## User outcome

The product goal is not “find the most accounts.” It is to help a person understand where a username appears on the public web while keeping evidence strength and uncertainty visible.

The interface therefore favors metrics that answer four product questions:

1. **Did the scan finish?**
2. **How much of the result set was resolved with strong evidence?**
3. **Where are the useful signals concentrated?**
4. **Where is source quality or availability creating uncertainty?**

## Metrics shown in the product

### Coverage

`returned sources / configured sources`

Coverage is a progress/completeness metric. It is not a success score.

### Exact resolution

`(FOUND + NOT_FOUND from exact adapters) / exact adapters attempted`

This is the primary evidence-quality KPI for a scan. It shows how often first-party or standards-based identity checks reached a definitive answer.

### Verified share

`FOUND / (FOUND + POSSIBLE)`

This describes the composition of positive signals. It does **not** estimate whether accounts belong to the same human.

### Uncertainty

`(UNKNOWN + BLOCKED) / attempted checks`

This is a source-health/observability metric. A higher value can reflect rate limits, source drift, network failures, or endpoints that do not provide enough evidence.

### P90 response time

The nearest-rank 90th percentile of observed source-check durations in the current scan. Median response time is shown alongside it.

These timings are operational observations from one scan, not benchmark claims.

## Visualizations

The evidence funnel is intentionally nested:

- sources attempted;
- exact checks;
- exact decisions;
- verified matches.

The category footprint chart keeps **Found** and **Maybe** separate so broad page signals never visually masquerade as verified identity evidence.

All chart values are also printed as text. Color is supplemental rather than the only way information is conveyed.

## Guardrails

Ariadne does not calculate:

- a privacy score;
- a reputation score;
- an identity-match probability;
- a risk score;
- a “digital footprint score” with synthetic precision.

Those metrics would imply more certainty than the evidence supports.

## Future product telemetry

If Ariadne ever adds opt-in product analytics, the minimum useful event set would be aggregate interaction events such as scan completion, filter use, export use, and source-error classes. Usernames and result URLs should not be analytics properties. Any persistent telemetry requires a separate privacy review and updated product disclosure before implementation.
