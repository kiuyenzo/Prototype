"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubmissionRequirementMatchType = void 0;
var SubmissionRequirementMatchType;
(function (SubmissionRequirementMatchType) {
    /**
     * Match for a submission_requirements entry in the presentation definition. If the match type
     * is `SubmissionRequirement` the {@link SubmissionRequirementMatch.id} property refers to the index
     * of the `submission_requirements` entry in the presentation definition.
     *
     * If the match is a nested match result, this match type refers to the nested index. E.g. a presentation
     * definition has three `submission_requirements` entries where the second submission requirement (index 1)
     * has two `from_nested` `submission_requirements` entries and this match refers to the second (index 1) of
     * this from nested, the {@link SubmissionRequirementMatch.id} property of the outer match refers to the outer index
     * in the `submission_requirements` entries, and the nested {@link SubmissionRequirementMatch.id} refers to index of the
     * `from_nested` entries. This can go multiple layers deep.
     */
    SubmissionRequirementMatchType["SubmissionRequirement"] = "SubmissionRequirement";
    /**
     * Match for an input_descriptors entry in the presentation definition. This type will be used
     * if no submission_requirements are present in the presentation definition. If the match type
     * is `InputDescriptor` the {@link SubmissionRequirementMatch.id} property refers to the `id`
     * of the `input_descriptors` entry in the presentation definition.
     */
    SubmissionRequirementMatchType["InputDescriptor"] = "InputDescriptor";
})(SubmissionRequirementMatchType || (exports.SubmissionRequirementMatchType = SubmissionRequirementMatchType = {}));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3VibWlzc2lvblJlcXVpcmVtZW50TWF0Y2guanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9saWIvZXZhbHVhdGlvbi9jb3JlL3N1Ym1pc3Npb25SZXF1aXJlbWVudE1hdGNoLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLElBQVksOEJBc0JYO0FBdEJELFdBQVksOEJBQThCO0lBQ3hDOzs7Ozs7Ozs7OztPQVdHO0lBQ0gsaUZBQStDLENBQUE7SUFFL0M7Ozs7O09BS0c7SUFDSCxxRUFBbUMsQ0FBQTtBQUNyQyxDQUFDLEVBdEJXLDhCQUE4Qiw4Q0FBOUIsOEJBQThCLFFBc0J6QyJ9