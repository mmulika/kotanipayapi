
function LoginController() {function isValidUserId(userList, user) {
    return userList.indexOf(user) >= 0;
 }return {
     isValidUserId
   }
 }
 module.exports = LoginController();/* Test */
 it('should return true if valid user id', function(){
       var isValid = loginController.isValidUserId(['abc123','xyz321'], 'abc123')
       assert.equal(isValid, true);
 });