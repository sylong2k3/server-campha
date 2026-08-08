'use strict';

const OPERATORS = Object.freeze({
    eq: (actual, expected) => actual === expected,
    gt: (actual, expected) => actual > expected,
    gte: (actual, expected) => actual >= expected,
    lt: (actual, expected) => actual < expected,
    lte: (actual, expected) => actual <= expected,
    between: (actual, expected) => actual >= expected[0] && actual <= expected[1],
});

const evaluateCondition = (condition, values) => {
    const reading = values[condition.variable];
    const compare = OPERATORS[condition.op];
    if (!reading || reading.unit !== condition.unit || !compare) {
        return false;
    }
    return compare(reading.value, condition.value);
};

const evaluateRule = (rule, values) => {
    if (Array.isArray(rule?.all)) {
        return rule.all.every((condition) => evaluateCondition(condition, values));
    }
    if (Array.isArray(rule?.any)) {
        return rule.any.some((condition) => evaluateCondition(condition, values));
    }
    return false;
};

const isScenarioEffective = (scenario, at) => {
    const instant = new Date(at).getTime();
    const from = scenario.effective_from ? new Date(scenario.effective_from).getTime() : -Infinity;
    const to = scenario.effective_to ? new Date(scenario.effective_to).getTime() : Infinity;
    return instant >= from && instant < to;
};

const matchScenarios = (scenarios, values, observedAt) => {
    const matches = scenarios.filter(
        (scenario) =>
            isScenarioEffective(scenario, observedAt) && evaluateRule(scenario.match_rule, values),
    );
    if (!matches.length) {
        return { status: 'no_match', scenarioId: null, candidateScenarioIds: [] };
    }
    const priority = Math.min(...matches.map((scenario) => Number(scenario.match_priority)));
    const winners = matches.filter((scenario) => Number(scenario.match_priority) === priority);
    if (winners.length > 1) {
        return {
            status: 'ambiguous',
            scenarioId: null,
            candidateScenarioIds: winners.map((scenario) => scenario.id),
        };
    }
    return {
        status: 'matched',
        scenarioId: winners[0].id,
        candidateScenarioIds: [winners[0].id],
    };
};

module.exports = { OPERATORS, evaluateRule, matchScenarios };
