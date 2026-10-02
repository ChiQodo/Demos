## Required workflow for every code change or code gen ##

1. Before editing, use Qodo Codebase Wisdom to explore affected components, dependencies, existing patterns and cross-repo impact. Don't edit until this is summarized
2. After implementing and running tests, use Qodo Review on local changes. Fix valid findings and then Review again. Maximum of 3 iterations, if findings still remain stop and report.
3. Then creat ethe PR
4. After Qodo reviews teh PR, use Review Resolver: Assess each finding for validty before changing code. Skip findings that are intentional due to the architecture
