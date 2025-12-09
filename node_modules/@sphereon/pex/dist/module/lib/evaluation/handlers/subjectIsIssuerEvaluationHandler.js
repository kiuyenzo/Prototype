import { Optionality } from '@sphereon/pex-models';
import { CredentialMapper } from '@sphereon/ssi-types';
import { Status } from '../../ConstraintUtils';
import PexMessages from '../../types/Messages';
import { getIssuerString, getSubjectIdsAsString, JsonPathUtils } from '../../utils';
import { AbstractEvaluationHandler } from './abstractEvaluationHandler';
export class SubjectIsIssuerEvaluationHandler extends AbstractEvaluationHandler {
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
            if (constraints?.subject_is_issuer === Optionality.Required) {
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
                const mappings = JsonPathUtils.extractInputField(wrappedVcs.map((wvc) => wvc.credential), [currentDescriptor.path]);
                for (const mapping of mappings) {
                    const issuer = getIssuerString(mapping.value);
                    if (mapping && mapping.value && getSubjectIdsAsString(mapping.value).every((item) => item === issuer)) {
                        this.getResults().push(this.generateSuccessResult(idIdx, currentDescriptor.path, CredentialMapper.toWrappedVerifiableCredential(mapping.value)));
                    }
                    else {
                        this.getResults().push(this.generateErrorResult(idIdx, currentDescriptor.path, CredentialMapper.toWrappedVerifiableCredential(mapping.value)));
                    }
                }
            }
        });
    }
    generateErrorResult(idIdx, vcPath, wvc) {
        return {
            input_descriptor_path: `$.input_descriptors[${idIdx}]`,
            evaluator: this.getName(),
            status: Status.ERROR,
            message: PexMessages.SUBJECT_IS_NOT_ISSUER,
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
            status: Status.INFO,
            message: message ?? PexMessages.SUBJECT_IS_ISSUER,
            verifiable_credential_path: vcPath,
            payload: {
                format: wvc.format,
            },
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3ViamVjdElzSXNzdWVyRXZhbHVhdGlvbkhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9saWIvZXZhbHVhdGlvbi9oYW5kbGVycy9zdWJqZWN0SXNJc3N1ZXJFdmFsdWF0aW9uSGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQWdDLFdBQVcsRUFBRSxNQUFNLHNCQUFzQixDQUFDO0FBQ2pGLE9BQU8sRUFBRSxnQkFBZ0IsRUFBd0YsTUFBTSxxQkFBcUIsQ0FBQztBQUU3SSxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sdUJBQXVCLENBQUM7QUFFL0MsT0FBTyxXQUFXLE1BQU0sc0JBQXNCLENBQUM7QUFDL0MsT0FBTyxFQUFFLGVBQWUsRUFBRSxxQkFBcUIsRUFBRSxhQUFhLEVBQUUsTUFBTSxhQUFhLENBQUM7QUFJcEYsT0FBTyxFQUFFLHlCQUF5QixFQUFFLE1BQU0sNkJBQTZCLENBQUM7QUFFeEUsTUFBTSxPQUFPLGdDQUFpQyxTQUFRLHlCQUF5QjtJQUM3RSxZQUFZLE1BQXdCO1FBQ2xDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNoQixDQUFDO0lBRU0sT0FBTztRQUNaLE9BQU8sMkJBQTJCLENBQUM7SUFDckMsQ0FBQztJQUVNLE1BQU0sQ0FBQyxFQUFtQyxFQUFFLFVBQXlDO1FBQzFGLHFEQUFxRDtRQUNwRCxFQUF1QyxDQUFDLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFDLGVBQWUsRUFBRSxLQUFLLEVBQUUsRUFBRTtZQUM1RixNQUFNLFdBQVcsR0FBOEMsZUFBZSxDQUFDLFdBQVcsQ0FBQztZQUMzRixJQUFJLFdBQVcsRUFBRSxpQkFBaUIsS0FBSyxXQUFXLENBQUMsUUFBUSxFQUFFLENBQUM7Z0JBQzVELGlGQUFpRjtnQkFDakYsSUFBSSxDQUFDLG9CQUFvQixDQUFDLGVBQWUsQ0FBQyxFQUFFLEVBQUUsVUFBVSxFQUFFLEtBQUssQ0FBQyxDQUFDO1lB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