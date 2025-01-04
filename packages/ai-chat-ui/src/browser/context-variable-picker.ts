// *****************************************************************************
// Copyright (C) 2025 EclipseSource GmbH.
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

import { AIVariableResolutionRequest, AIVariableService } from '@theia/ai-core';
import { QuickInputService } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';

@injectable()
export class ContextVariablePicker {

    @inject(AIVariableService)
    protected readonly variableService: AIVariableService;

    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;

    async pickContextVariable(): Promise<AIVariableResolutionRequest | undefined> {
        const variables = this.variableService.getVariables();
        const selection = await this.quickInputService.showQuickPick(
            variables.map(v => ({
                id: v.id,
                label: v.label ?? v.name,
                variable: v,
            })),
            {
                placeholder: 'Select a context variable to be attached to the message',
            }
        );
        if (!selection) {
            return undefined;
        }

        const queryContext = { type: 'context-variable-picker' };
        const variable = selection.variable;
        if (!variable.args || variable.args.length === 0) {
            return { variable };
        }

        const argumentPicker = await this.variableService.getArgumentPicker(variable.name, queryContext);
        if (!argumentPicker) {
            const argSelection = await this.quickInputService.showQuickPick(
                variable.args.map(argument => ({
                    id: argument.name,
                    label: argument.name + (argument.description ? `: ${argument.description}` : ''),
                })),
                {
                    placeholder: 'Select a context variable to be attached to the message',
                }
            );
            return { variable, arg: argSelection?.id };
        }

        const arg = await argumentPicker(queryContext);
        if (!arg) {
            return undefined;
        }

        return { variable, arg };
    }
}
