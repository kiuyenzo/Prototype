// console.log("Hello Word");
// let age: number = 20;
// if (age < 50)
//     age += 10;
// console.log(age);
// //age = "a";


//let sales: number = 123_453_679; number kann man wegstreichen weil eer es automatisch erkennt
let sales: 123_453_679; 
let course: string = "TyeScript";
let is_published: boolean = true;
let level; //ts denkt es ist Typ any
level = 1;
level = "a";

function render(document: any) {
    console.log(document);
}
