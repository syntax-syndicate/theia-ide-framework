// *****************************************************************************
// Copyright (C) 2024 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Partially copied from https://github.com/microsoft/vscode/blob/a2cab7255c0df424027be05d58e1b7b941f4ea60/src/vs/workbench/contrib/chat/common/chatVariables.ts

import { ContributionProvider, Disposable, Emitter, ILogger, MaybePromise, Prioritizeable, Event } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';

export interface AIVariable {
    /** provider id */
    id: string;
    /** variable name, used for referencing variables in the chat */
    name: string;
    /** variable description */
    description: string;
    /** optional label, used for showing a variable type in the UI. If not provided, the variable name is used */
    label?: string;
    /** optional arguments for resolving the variable into a value */
    args?: AIVariableDescription[];
}

export interface AIVariableDescription {
    name: string;
    description: string;
}

export interface ResolvedAIVariable {
    variable: AIVariable;
    arg?: string;
    /** value that is inserted into the prompt at the position of the variable usage */
    value: string;
    /** optional additional value that is available to AI agents in the context when this variable is added */
    contextValue?: string;
}

export interface AIVariableResolutionRequest {
    variable: AIVariable;
    arg?: string;
}

export namespace AIVariableResolutionRequest {
    export function is(arg: unknown): arg is AIVariableResolutionRequest {
        return !!arg && typeof arg === 'object' &&
            'variable' in arg &&
            typeof (arg as { variable: { name: unknown } }).variable.name === 'string';
    }
}

export interface AIVariableContext {
}

export type AIVariableArg = string | { variable: string, arg?: string } | AIVariableResolutionRequest;

export type AIVariableArgPicker = (context: AIVariableContext) => MaybePromise<string | undefined>;

export interface AIVariableResolver {
    canResolve(request: AIVariableResolutionRequest, context: AIVariableContext): MaybePromise<number>,
    resolve(request: AIVariableResolutionRequest, context: AIVariableContext): Promise<ResolvedAIVariable | undefined>;
}

export const AIVariableService = Symbol('AIVariableService');
export interface AIVariableService {
    hasVariable(name: string): boolean;
    getVariable(name: string): Readonly<AIVariable> | undefined;
    getVariables(): Readonly<AIVariable>[];
    unregisterVariable(name: string): void;
    readonly onDidChangeVariables: Event<void>;

    registerResolver(variable: AIVariable, resolver: AIVariableResolver): Disposable;
    unregisterResolver(variable: AIVariable, resolver: AIVariableResolver): void;
    getResolver(name: string, arg: string | undefined, context: AIVariableContext): Promise<AIVariableResolver | undefined>;

    registerArgumentPicker(variable: AIVariable, argPicker: AIVariableArgPicker): Disposable;
    unregisterArgumentPicker(variable: AIVariable, argPicker: AIVariableArgPicker): void;
    getArgumentPicker(name: string, context: AIVariableContext): Promise<AIVariableArgPicker | undefined>;

    resolveVariable(variable: AIVariableArg, context: AIVariableContext): Promise<ResolvedAIVariable | undefined>;
}

export const AIVariableContribution = Symbol('AIVariableContribution');
export interface AIVariableContribution {
    registerVariables(service: AIVariableService): void;
}

@injectable()
export class DefaultAIVariableService implements AIVariableService {
    protected variables = new Map<string, AIVariable>();
    protected resolvers = new Map<string, AIVariableResolver[]>();
    protected argPickers = new Map<string, AIVariableArgPicker>();

    protected readonly onDidChangeVariablesEmitter = new Emitter<void>();
    readonly onDidChangeVariables: Event<void> = this.onDidChangeVariablesEmitter.event;

    @inject(ILogger) protected logger: ILogger;

    constructor(
        @inject(ContributionProvider) @named(AIVariableContribution)
        protected readonly contributionProvider: ContributionProvider<AIVariableContribution>
    ) {
    }

    protected initContributions(): void {
        this.contributionProvider.getContributions().forEach(contribution => contribution.registerVariables(this));
    }

    protected getKey(name: string): string {
        return `${name.toLowerCase()}`;
    }

    async getResolver(name: string, arg: string | undefined, context: AIVariableContext): Promise<AIVariableResolver | undefined> {
        const resolvers = await this.prioritize(name, arg, context);
        return resolvers[0];
    }

    protected getResolvers(name: string): AIVariableResolver[] {
        return this.resolvers.get(this.getKey(name)) ?? [];
    }

    protected async prioritize(name: string, arg: string | undefined, context: AIVariableContext): Promise<AIVariableResolver[]> {
        const variable = this.getVariable(name);
        if (!variable) {
            return [];
        }
        const prioritized = await Prioritizeable.prioritizeAll(this.getResolvers(name), async resolver => {
            try {
                return await resolver.canResolve({ variable, arg }, context);
            } catch {
                return 0;
            }
        });
        return prioritized.map(p => p.value);
    }

    hasVariable(name: string): boolean {
        return !!this.getVariable(name);
    }

    getVariable(name: string): Readonly<AIVariable> | undefined {
        return this.variables.get(this.getKey(name));
    }

    getVariables(): Readonly<AIVariable>[] {
        return [...this.variables.values()];
    }

    registerResolver(variable: AIVariable, resolver: AIVariableResolver): Disposable {
        const key = this.getKey(variable.name);
        if (!this.variables.get(key)) {
            this.variables.set(key, variable);
            this.onDidChangeVariablesEmitter.fire();
        }
        const resolvers = this.resolvers.get(key) ?? [];
        resolvers.push(resolver);
        this.resolvers.set(key, resolvers);
        return Disposable.create(() => this.unregisterResolver(variable, resolver));
    }

    unregisterResolver(variable: AIVariable, resolver: AIVariableResolver): void {
        const key = this.getKey(variable.name);
        const registeredResolvers = this.resolvers.get(key);
        registeredResolvers?.splice(registeredResolvers.indexOf(resolver), 1);
        if (registeredResolvers?.length === 0) {
            this.unregisterVariable(variable.name);
        }
    }

    unregisterVariable(name: string): void {
        this.variables.delete(this.getKey(name));
        this.resolvers.delete(this.getKey(name));
        this.onDidChangeVariablesEmitter.fire();
    }

    registerArgumentPicker(variable: AIVariable, argPicker: AIVariableArgPicker): Disposable {
        const key = this.getKey(variable.name);
        this.argPickers.set(key, argPicker);
        return Disposable.create(() => this.unregisterArgumentPicker(variable, argPicker));
    }

    unregisterArgumentPicker(variable: AIVariable, argPicker: AIVariableArgPicker): void {
        const key = this.getKey(variable.name);
        const registeredArgPicker = this.argPickers.get(key);
        if (registeredArgPicker === argPicker) {
            this.argPickers.delete(key);
        }
    }

    async getArgumentPicker(name: string): Promise<AIVariableArgPicker | undefined> {
        return this.argPickers.get(this.getKey(name)) ?? undefined;
    }

    async resolveVariable(request: AIVariableArg, context: AIVariableContext): Promise<ResolvedAIVariable | undefined> {
        const variableName = typeof request === 'string' ? request : typeof request.variable === 'string' ? request.variable : request.variable.name;
        const variable = this.getVariable(variableName);
        if (!variable) {
            return undefined;
        }
        const arg = typeof request === 'string' ? undefined : request.arg;
        const resolver = await this.getResolver(variableName, arg, context);
        const resolved = await resolver?.resolve({ variable, arg }, context);
        return resolved ? { ...resolved, arg } : undefined;
    }
}
