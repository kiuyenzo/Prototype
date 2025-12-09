import { Format, PresentationSubmission } from '@sphereon/pex-models';
import { WrappedVerifiableCredential, WrappedVerifiablePresentation } from '@sphereon/ssi-types';
import { Status } from '../ConstraintUtils';
import { PresentationSubmissionLocation } from '../signing';
import { IInternalPresentationDefinition, OrArray } from '../types';
import { EvaluationResults, PresentationEvaluationResults, SelectResults, SubmissionRequirementMatch } from './core';
import { EvaluationClient } from './evaluationClient';
export declare class EvaluationClientWrapper {
    private _client;
    constructor();
    getEvaluationClient(): EvaluationClient;
    selectFrom(presentationDefinition: IInternalPresentationDefinition, wrappedVerifiableCredentials: WrappedVerifiableCredential[], opts?: {
        holderDIDs?: string[];
        limitDisclosureSignatureSuites?: string[];
        restrictToFormats?: Format;
        restrictToDIDMethods?: string[];
    }): SelectResults;
    private remapMatches;
    private extractMatches;
    /**
     * Since this is without SubmissionRequirements object, each InputDescriptor has to have at least one corresponding VerifiableCredential
     * @param marked: info logs for `MarkForSubmissionEvaluation` handler
     * @param pd
     * @private
     */
    private checkWithoutSubmissionRequirements;
    private matchSubmissionRequirements;
    private matchWithoutSubmissionRequirements;
    private getMatchingVcPathsForSubmissionRequirement;
    evaluate(pd: IInternalPresentationDefinition, wvcs: WrappedVerifiableCredential[], opts?: {
        holderDIDs?: string[];
        limitDisclosureSignatureSuites?: string[];
        restrictToFormats?: Format;
        presentationSubmission?: PresentationSubmission;
        generatePresentationSubmission?: boolean;
    }): EvaluationResults;
    evaluatePresentations(pd: IInternalPresentationDefinition, wvps: OrArray<WrappedVerifiablePresentation>, opts?: {
        holderDIDs?: string[];
        limitDisclosureSignatureSuites?: string[];
        restrictToFormats?: Format;
        presentationSubmission?: PresentationSubmission;
        generatePresentationSubmission?: boolean;
        /**
         * The location of the presentation submission. By default {@link PresentationSubmissionLocation.PRESENTATION}
         * is used when one W3C presentation is passed (not as array) , while {@link PresentationSubmissionLocation.EXTERNAL} is
         * used when an array is passed or the presentation is not a W3C presentation
         */
        presentationSubmissionLocation?: PresentationSubmissionLocation;
    }): PresentationEvaluationResults;
    private extractWrappedVcFromWrappedVp;
    private evaluatePresentationsAgainstSubmission;
    private checkIfSubmissionSatisfiesSubmissionRequirement;
    /**
     * Checks whether a submission satisfies the requirements of a presentation definition
     */
    private validateIfSubmissionSatisfiesDefinition;
    private internalPresentationDefinitionForDescriptor;
    private formatNotInfo;
    submissionFrom(pd: IInternalPresentationDefinition, vcs: WrappedVerifiableCredential[], opts?: {
        presentationSubmissionLocation?: PresentationSubmissionLocation;
    }): PresentationSubmission;
    private updatePresentationSubmission;
    private updatePresentationSubmissionToExternal;
    private updateDescriptorToExternal;
    private matchUserSelectedVcs;
    private evaluateRequirements;
    private countMatchingInputDescriptors;
    private handleCount;
    private removeDuplicateSubmissionRequirementMatches;
    fillSelectableCredentialsToVerifiableCredentialsMapping(selectResults: SelectResults, wrappedVcs: WrappedVerifiableCredential[]): void;
    determineAreRequiredCredentialsPresent(presentationDefinition: IInternalPresentationDefinition, matchSubmissionRequirements: SubmissionRequirementMatch[] | undefined, parentMsr?: SubmissionRequirementMatch): Status;
    private determineSubmissionRequirementStatus;
    private getPickRuleStatus;
    private updateSubmissionRequirementMatchPathToAlias;
    private updatePresentationSubmissionPathToVpPath;
    private replacePathWithAlias;
    private createIdToVcMap;
    private countGroupIDs;
}
