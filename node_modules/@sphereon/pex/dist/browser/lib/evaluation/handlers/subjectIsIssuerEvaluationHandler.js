"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubjectIsIssuerEvaluationHandler = void 0;
const pex_models_1 = require("@sphereon/pex-models");
const ssi_types_1 = require("@sphereon/ssi-types");
const ConstraintUtils_1 = require("../../ConstraintUtils");
const Messages_1 = __importDefault(require("../../types/Messages"));
const utils_1 = require("../../utils");
const abstractEvaluationHandler_1 = require("./abstractEvaluationHandler");
class SubjectIsIssuerEvaluationHandler extends abstractEvaluationHandler_1.AbstractEvaluationHandler {
    constructor(client) {
        super(client);
    }
    getName() {
        return 'SubjectIsIssuerEvaluation';
    }
    handle(pd, wrappedVcs) {
        // PresentationDefinitionV2 is the common denominator
        pd.input_descriptors.forEach((inputDescriptor, index) => {
            const constraints = inputDescriptor.constraints;
            if ((constraints === null || constraints === void 0 ? void 0 : constraints.subject_is_issuer) === pex_models_1.Optionality.Required) {
                // @todo: Huh, this should also be checked when preferred, but without any errors
                this.checkSubjectIsIssuer(inputDescriptor.id, wrappedVcs, index);
            }
            else {
                // Why is this here?
                this.getResults().push(...wrappedVcs.map((wvc, vcIndex) => this.generateSuccessResult(index, `$[${vcIndex}]`, wvc, 'not applicable')));
            }
        });
        this.updatePresentationSubmission(pd);
    }
    checkSubjectIsIssuer(inputDescriptorId, wrappedVcs, idIdx) {
        this.client.presentationSubmission.descriptor_map.forEach((currentDescriptor) => {
            if (currentDescriptor.id === inputDescriptorId) {
                const mappings = utils_1.JsonPathUtils.extractInputField(wrappedVcs.map((wvc) => wvc.credential), [currentDescriptor.path]);
                for (const mapping of mappings) {
                    const issuer = (0, utils_1.getIssuerString)(mapping.value);
                    if (mapping && mapping.value && (0, utils_1.getSubjectIdsAsString)(mapping.value).every((item) => item === issuer)) {
                        this.getResults().push(this.generateSuccessResult(idIdx, currentDescriptor.path, ssi_types_1.CredentialMapper.toWrappedVerifiableCredential(mapping.value)));
                    }
                    else {
                        this.getResults().push(this.generateErrorResult(idIdx, currentDescriptor.path, ssi_types_1.CredentialMapper.toWrappedVerifiableCredential(mapping.value)));
                    }
                }
            }
        });
    }
    generateErrorResult(idIdx, vcPath, wvc) {
        return {
            input_descriptor_path: `$.input_descriptors[${idIdx}]`,
            evaluator: this.getName(),
            status: ConstraintUtils_1.Status.ERROR,
            message: Messages_1.default.SUBJECT_IS_NOT_ISSUER,
            verifiable_credential_path: vcPath,
            payload: {
                format: wvc.format,
            },
        };
    }
    generateSuccessResult(idIdx, vcPath, wvc, message) {
        return {
            input_descriptor_path: `$.input_descriptors[${idIdx}]`,
            evaluator: this.getName(),
            status: ConstraintUtils_1.Status.INFO,
            message: message !== null && message !== void 0 ? message : Messages_1.default.SUBJECT_IS_ISSUER,
            verifiable_credential_path: vcPath,
            payload: {
                format: wvc.format,
            },
        };
    }
}
exports.SubjectIsIssuerEvaluationHandler = SubjectIsIssuerEvaluationHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3ViamVjdElzSXNzdWVyRXZhbHVhdGlvbkhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9saWIvZXZhbHVhdGlvbi9oYW5kbGVycy9zdWJqZWN0SXNJc3N1ZXJFdmFsdWF0aW9uSGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxxREFBaUY7QUFDakYsbURBQTZJO0FBRTdJLDJEQUErQztBQUUvQyxvRUFBK0M7QUFDL0MsdUNBQW9GO0FBSXBGLDJFQUF3RTtBQUV4RSxNQUFhLGdDQUFpQyxTQUFRLHFEQUF5QjtJQUM3RSxZQUFZLE1BQXdCO1FBQ2xDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNoQixDQUFDO0lBRU0sT0FBTztRQUNaLE9BQU8sMkJBQTJCLENBQUM7SUFDckMsQ0FBQztJQUVNLE1BQU0sQ0FBQyxFQUFtQyxFQUFFLFVBQXlDO1FBQzFGLHFEQUFxRDtRQUNwRCxFQUF1QyxDQUFDLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFDLGVBQWUsRUFBRSxLQUFLLEVBQUUsRUFBRTtZQUM1RixNQUFNLFdBQVcsR0FBOEMsZUFBZSxDQUFDLFdBQVcsQ0FBQztZQUMzRixJQUFJLENBQUEsV0FBVyxhQUFYLFdBQVcsdUJBQVgsV0FBVyxDQUFFLGlCQUFpQixNQUFLLHdCQUFXLENBQUMsUUFBUSxFQUFFLENBQUM7Z0JBQzVELGlGQUFpRjtnQkFDakYsSUFBSSxDQUFDLG9CQUFvQixDQUFDLGVBQWUsQ0FBQyxFQUFFLEVBQUUsVUFBVSxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ25FLENBQUM7aUJBQU0sQ0FBQztnQkFDTixvQkFBb0I7Z0JBQ3BCLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLE9BQU8sRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEtBQUssRUFBRSxL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