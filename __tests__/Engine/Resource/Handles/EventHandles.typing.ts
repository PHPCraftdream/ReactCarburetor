// Type-only checks for D2: a parameterless resource's handles bind straight to an event
// handler; a resource with parameters rejects that assignment. Runtime behavior is covered
// by EventHandles.test.tsx.
import * as React from 'react';
import {ResourceCarburetor} from '@/Carburetor/Resource/ResourceCarburetor';

const zero = new ResourceCarburetor(async () => 'answer');
const withArgs = new ResourceCarburetor<string, [id: string]>(async id => id);

// A parameterless resource binds directly to onClick (the handler may ignore the event).
{
    const props: {onClick?: React.MouseEventHandler<HTMLButtonElement>} = {onClick: zero.load};
    const refresh: {onClick?: React.MouseEventHandler<HTMLButtonElement>} = {onClick: zero.refresh};
    void props;
    void refresh;
}

// A resource with parameters needs a method that passes the arguments (§7).
{
    const props: {onClick?: React.MouseEventHandler<HTMLButtonElement>} = {
        // @ts-expect-error — the mouse event is not a valid loader argument
        onClick: withArgs.load,
    };
    void props;
}
